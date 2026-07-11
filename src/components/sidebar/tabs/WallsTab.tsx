import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, CloseButton, Group, NumberInput, Paper, Stack, Text,
} from '@mantine/core';
import type { GridEdge, InnerWall } from '../../../lib/types';
import {
  edgeKey, perimeterEdges, internalEdges, toggleEdge,
} from '../../../lib/edges';
import { flattenBins } from '../../../lib/split';
import { GRID_PITCH, HEIGHT_PER_UNIT, FLOOR_THICKNESS } from '../../../lib/geometry/gridfinity';
import { useAppStore } from '../../../store';
import { EditorCanvas } from '../EditorCanvas';
import { CELL, gridToSvg, mmToSvg, pointerToMm } from '../editorCoords';
import { Hint, Label } from '../../ui/Field';

interface Pt { x: number; y: number }

const snapMm = (mm: number) => Math.round(mm * 2) / 2;

// Drawing aids: endpoints magnetize to grid intersections and custom-wall
// endpoints within POINT_SNAP_MM, to points along grid lines and existing
// walls within LINE_SNAP_MM, and the segment locks to 45° increments when the
// drag is within ANGLE_SNAP_RAD of one. Points snap harder than lines so
// corners and wall ends win when both are in range.
const POINT_SNAP_MM = 6;
const LINE_SNAP_MM = 4;
const ANGLE_SNAP_RAD = (7 * Math.PI) / 180;

// Max perpendicular distance (mm) from the pointer to a grid line for a press
// to pick up the edge on that line.
const EDGE_PICK_MM = 8;
// Max distance (mm) from the pointer to a custom wall for a click to select it.
const WALL_PICK_MM = 4;
// Pointer travel (mm) before a pending press commits to a drag gesture.
const MOVE_THRESHOLD_MM = 2.5;

function gridSnap(mm: number): number {
  const line = Math.round(mm / GRID_PITCH) * GRID_PITCH;
  return Math.abs(mm - line) <= LINE_SNAP_MM ? line : snapMm(mm);
}

/** Closest point to p on segment w, with its distance. */
function closestOnWall(p: Pt, w: InnerWall): { x: number; y: number; dist: number } {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / lenSq));
  const x = w.x1 + t * dx, y = w.y1 + t * dy;
  return { x, y, dist: Math.hypot(p.x - x, p.y - y) };
}

/** Index of the custom wall within WALL_PICK_MM of p, or null. */
function nearestWall(p: Pt, walls: InnerWall[]): number | null {
  let best: number | null = null;
  let bestDist = WALL_PICK_MM;
  walls.forEach((w, i) => {
    const { dist } = closestOnWall(p, w);
    if (dist <= bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

/**
 * Point snap tier: custom-wall endpoints and grid intersections within
 * POINT_SNAP_MM of p, nearest first. These beat line and 45° snaps so free
 * walls join cleanly at corners and existing wall ends.
 */
function pointSnap(p: Pt, walls: InnerWall[]): Pt | null {
  const candidates: Pt[] = walls.flatMap((w) => [
    { x: w.x1, y: w.y1 },
    { x: w.x2, y: w.y2 },
  ]);
  const ix = Math.round(p.x / GRID_PITCH) * GRID_PITCH;
  const iy = Math.round(p.y / GRID_PITCH) * GRID_PITCH;
  if (Math.abs(p.x - ix) <= POINT_SNAP_MM && Math.abs(p.y - iy) <= POINT_SNAP_MM) {
    candidates.push({ x: ix, y: iy });
  }
  let best: Pt | null = null;
  let bestDist = POINT_SNAP_MM;
  for (const c of candidates) {
    const dist = Math.hypot(p.x - c.x, p.y - c.y);
    if (dist <= bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

/** Snap a raw mm point: wall endpoints & grid intersections beat line snaps. */
function snapPoint(p: Pt, walls: InnerWall[]): Pt {
  const pt = pointSnap(p, walls);
  if (pt) return pt;
  let best: { x: number; y: number; dist: number } | null = null;
  for (const w of walls) {
    const c = closestOnWall(p, w);
    if (c.dist <= LINE_SNAP_MM && (!best || c.dist < best.dist)) best = c;
  }
  if (best) return { x: snapMm(best.x), y: snapMm(best.y) };
  return { x: gridSnap(p.x), y: gridSnap(p.y) };
}

/** Endpoint for a draft from (x1,y1) toward p, with point, grid + 45° snapping. */
function snapEnd(x1: number, y1: number, p: Pt, walls: InnerWall[]): { x2: number; y2: number } {
  const pt = pointSnap(p, walls);
  if (pt) return { x2: pt.x, y2: pt.y };
  let { x, y } = snapPoint(p, walls);
  const dx = x - x1, dy = y - y1;
  if (Math.hypot(dx, dy) < 2) return { x2: x, y2: y };
  const step = Math.PI / 4;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / step) * step;
  if (Math.abs(angle - snapped) <= ANGLE_SNAP_RAD) {
    const ux = Math.cos(snapped), uy = Math.sin(snapped);
    const t = dx * ux + dy * uy;
    x = snapMm(x1 + t * ux);
    y = snapMm(y1 + t * uy);
    if (Math.abs(ux) < 1e-6) x = x1;  // exact vertical
    if (Math.abs(uy) < 1e-6) y = y1;  // exact horizontal
  }
  return { x2: x, y2: y };
}

function edgeEndpoints(e: GridEdge): { x1: number; y1: number; x2: number; y2: number } {
  const x = gridToSvg(e.x);
  const y = gridToSvg(e.y);
  return e.orientation === 'h'
    ? { x1: x, y1: y, x2: x + CELL, y2: y }
    : { x1: x, y1: y, x2: x, y2: y + CELL };
}

interface Draft { x1: number; y1: number; x2: number; y2: number }

type EdgeLayer = 'perimeter' | 'internal';

interface EdgeHit { edge: GridEdge; layer: EdgeLayer }

/**
 * One pointer gesture on the canvas. A press starts 'pending' when it lands on
 * a grid edge or custom wall; the first significant move decides what it is.
 * A grid drag is locked to one grid line — changing direction requires a
 * release and a new press.
 */
type Gesture =
  | { kind: 'pending'; start: Pt; edgeHit: EdgeHit | null; wallHit: number | null }
  | {
      kind: 'grid'; layer: EdgeLayer;
      /** true = drag makes edges active (open / divider), false = drag clears them */
      adding: boolean;
      orientation: 'h' | 'v';
      /** locked grid-line index; the drag can only extend along this line */
      line: number;
      startCell: number; endCell: number;
    }
  | { kind: 'free'; draft: Draft };

/** Shared width for the compact wall width/height number fields. */
const WALL_DIMENSION_INPUT_WIDTH = 56;

const LEGEND = [
  { label: 'outer wall', kind: 'wall' },
  { label: 'open', kind: 'open' },
  { label: 'divider', kind: 'divider' },
  { label: 'custom', kind: 'custom' },
];

export function WallsTab() {
  const { config, updateConfig, gridCols, gridRows } = useAppStore();
  const { openEdges, dividerEdges, innerWalls } = config;
  const cells = flattenBins(config.bins);
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);

  // Cell membership for confining custom walls to the bins' footprint.
  const cellSet = useMemo(
    () => new Set(flattenBins(config.bins).map((c) => `${c.x},${c.y}`)),
    [config.bins],
  );

  /**
   * Whether a whole-bin mm point lies inside (or on the boundary of) any bin
   * cell. The small tolerance lets points exactly on a shared or perimeter
   * grid line count as inside, so walls can end on the outer wall.
   */
  function insideBins(p: Pt): boolean {
    const eps = 0.01;
    for (const cx of [Math.floor((p.x - eps) / GRID_PITCH), Math.floor((p.x + eps) / GRID_PITCH)]) {
      for (const cy of [Math.floor((p.y - eps) / GRID_PITCH), Math.floor((p.y + eps) / GRID_PITCH)]) {
        if (cellSet.has(`${cx},${cy}`)) return true;
      }
    }
    return false;
  }

  /**
   * Clamp a draft endpoint so the whole segment from `from` stays inside the
   * bins: walk the segment in small steps and keep the farthest point before
   * it first leaves the footprint (which also stops segments from cutting
   * across notches in concave shapes).
   */
  function clampToBins(from: Pt, to: Pt): Pt {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    let last = from;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const q = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (!insideBins(q)) {
        const r = { x: snapMm(last.x), y: snapMm(last.y) };
        return insideBins(r) ? r : last;
      }
      last = q;
    }
    return to; // fully inside — keep the snapped endpoint exactly
  }

  const hasOverrides = openEdges.length > 0 || dividerEdges.length > 0;
  const cavityDepth = HEIGHT_PER_UNIT * config.heightUnits - FLOOR_THICKNESS;

  // Multi-bin classification: an edge between two different bins is a
  // perimeter edge of BOTH bins (a real double wall); internal edges exist
  // only within a single bin. Memoized so the per-pointer-move draft renders
  // don't re-run the flood fill and edge scans.
  const { perimeter, internal } = useMemo(() => {
    const perimeter = new Map<string, GridEdge>();
    const internal = new Map<string, GridEdge>();
    for (const b of config.bins) {
      for (const e of perimeterEdges(b.cells)) perimeter.set(edgeKey(e), e);
      for (const e of internalEdges(b.cells)) internal.set(edgeKey(e), e);
    }
    return { perimeter, internal };
  }, [config.bins]);

  // Rendered edge overlay. Memoized so per-pointer-move renders (the gesture
  // state changes on every move) don't reconcile the whole edge layer.
  // Perimeter edges toggle openEdges; internal toggle dividerEdges. Toggling
  // happens through the SVG-level gesture handlers, so edges carry no click
  // handlers of their own — the hit line only provides hover/cursor.
  const edgeElements = useMemo(() => {
    const layers = [
      {
        edges: [...perimeter.values()],
        activeSet: new Set(openEdges.map(edgeKey)),
        activeClass: 'edge-line edge-line--open',   // wall removed
        inactiveClass: 'edge-line edge-line--wall', // solid wall
      },
      {
        edges: [...internal.values()],
        activeSet: new Set(dividerEdges.map(edgeKey)),
        activeClass: 'edge-line edge-line--divider', // divider
        inactiveClass: 'edge-line edge-line--ghost', // ghost
      },
    ];
    return layers.flatMap(({ edges, activeSet, activeClass, inactiveClass }) =>
      edges.map((e) => {
        const key = edgeKey(e);
        const p = edgeEndpoints(e);
        return (
          <g key={key} className="edge">
            <line {...p} stroke="transparent" strokeWidth={12} strokeLinecap="round" />
            <line {...p} className={activeSet.has(key) ? activeClass : inactiveClass} />
          </g>
        );
      }),
    );
  }, [perimeter, internal, openEdges, dividerEdges]);

  // Delete/Backspace removes the selected custom wall; Escape deselects.
  useEffect(() => {
    if (selectedWall == null) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        updateConfig({ innerWalls: innerWalls.filter((_, j) => j !== selectedWall) });
        setSelectedWall(null);
      } else if (ev.key === 'Escape') {
        setSelectedWall(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedWall, innerWalls, updateConfig]);

  if (cells.length === 0) {
    return <Hint>Select cells in the Shape tab first.</Hint>;
  }

  function svgPoint(e: React.PointerEvent): Pt {
    return pointerToMm(svgRef.current!, e);
  }

  /** Nearest existing grid edge within EDGE_PICK_MM of a whole-bin mm point. */
  function nearestEdge(p: Pt): EdgeHit | null {
    const gx = p.x / GRID_PITCH, gy = p.y / GRID_PITCH;
    const candidates: Array<{ edge: GridEdge; dist: number }> = [
      {
        edge: { x: Math.floor(gx), y: Math.round(gy), orientation: 'h' as const },
        dist: Math.abs(gy - Math.round(gy)) * GRID_PITCH,
      },
      {
        edge: { x: Math.round(gx), y: Math.floor(gy), orientation: 'v' as const },
        dist: Math.abs(gx - Math.round(gx)) * GRID_PITCH,
      },
    ].sort((a, b) => a.dist - b.dist);
    for (const { edge, dist } of candidates) {
      if (dist > EDGE_PICK_MM) continue;
      const key = edgeKey(edge);
      if (perimeter.has(key)) return { edge: perimeter.get(key)!, layer: 'perimeter' };
      if (internal.has(key)) return { edge: internal.get(key)!, layer: 'internal' };
    }
    return null;
  }

  function activeKeys(layer: EdgeLayer): Set<string> {
    return new Set((layer === 'perimeter' ? openEdges : dividerEdges).map(edgeKey));
  }

  /** The cell index of a whole-bin mm point along a grid line's axis. */
  function cellAlong(p: Pt, orientation: 'h' | 'v'): number {
    const along = orientation === 'h' ? p.x : p.y;
    const max = (orientation === 'h' ? gridCols : gridRows) - 1;
    return Math.max(0, Math.min(max, Math.floor(along / GRID_PITCH)));
  }

  /**
   * Edges a grid drag would toggle: the contiguous span between startCell and
   * endCell on the locked line, restricted to edges that exist on the drag's
   * layer and whose state would actually change. Derived from the span each
   * move, so fast drags can't skip edges and backing up shrinks the preview.
   */
  function spanEdges(g: Extract<Gesture, { kind: 'grid' }>): GridEdge[] {
    const map = g.layer === 'perimeter' ? perimeter : internal;
    const active = activeKeys(g.layer);
    const lo = Math.min(g.startCell, g.endCell);
    const hi = Math.max(g.startCell, g.endCell);
    const out: GridEdge[] = [];
    for (let c = lo; c <= hi; c++) {
      const e: GridEdge = g.orientation === 'h'
        ? { x: c, y: g.line, orientation: 'h' }
        : { x: g.line, y: c, orientation: 'v' };
      const key = edgeKey(e);
      if (!map.has(key)) continue;
      if (active.has(key) === g.adding) continue; // already in target state
      out.push(map.get(key)!);
    }
    return out;
  }

  function down(e: React.PointerEvent) {
    const p = svgPoint(e);
    const edgeHit = nearestEdge(p);
    const wallHit = nearestWall(p, innerWalls);
    if (edgeHit || wallHit != null) {
      // Wait for movement (or release) to decide what this press means.
      setGesture({ kind: 'pending', start: p, edgeHit, wallHit });
    } else if (insideBins(p)) {
      const s = snapPoint(p, innerWalls);
      setGesture({ kind: 'free', draft: { x1: s.x, y1: s.y, x2: s.x, y2: s.y } });
      setSelectedWall(null);
    } else {
      // Presses outside the bins' footprint start nothing.
      setSelectedWall(null);
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent) {
    if (!gesture) return;
    const p = svgPoint(e);
    if (gesture.kind === 'pending') {
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD_MM) return;
      // "Along the line" is strict (within ~27°) so a clearly diagonal drag
      // that happens to start on a grid edge still draws a free wall.
      const hit = gesture.edgeHit;
      const alongEdge = hit != null && (hit.edge.orientation === 'h'
        ? Math.abs(dx) >= 2 * Math.abs(dy)
        : Math.abs(dy) >= 2 * Math.abs(dx));
      if (hit && alongEdge) {
        // Pencil semantics: the first edge decides activate vs clear.
        const orientation = hit.edge.orientation;
        setGesture({
          kind: 'grid',
          layer: hit.layer,
          adding: !activeKeys(hit.layer).has(edgeKey(hit.edge)),
          orientation,
          line: orientation === 'h' ? hit.edge.y : hit.edge.x,
          startCell: orientation === 'h' ? hit.edge.x : hit.edge.y,
          endCell: cellAlong(p, orientation),
        });
      } else {
        const s = snapPoint(gesture.start, innerWalls);
        const end = snapEnd(s.x, s.y, p, innerWalls);
        const c = clampToBins(s, { x: end.x2, y: end.y2 });
        setGesture({
          kind: 'free',
          draft: { x1: s.x, y1: s.y, x2: c.x, y2: c.y },
        });
      }
      setSelectedWall(null);
    } else if (gesture.kind === 'grid') {
      const endCell = cellAlong(p, gesture.orientation);
      if (endCell !== gesture.endCell) setGesture({ ...gesture, endCell });
    } else {
      const { draft } = gesture;
      const end = snapEnd(draft.x1, draft.y1, p, innerWalls);
      const c = clampToBins({ x: draft.x1, y: draft.y1 }, { x: end.x2, y: end.y2 });
      setGesture({
        ...gesture,
        draft: { ...draft, x2: c.x, y2: c.y },
      });
    }
  }

  function up() {
    if (!gesture) return;
    if (gesture.kind === 'pending') {
      // A plain click: select the wall under the pointer, else toggle the edge.
      if (gesture.wallHit != null) {
        const i = gesture.wallHit;
        setSelectedWall((s) => (s === i ? null : i));
      } else if (gesture.edgeHit) {
        const { edge, layer } = gesture.edgeHit;
        if (layer === 'perimeter') {
          updateConfig({ openEdges: toggleEdge(openEdges, edge) });
        } else {
          updateConfig({ dividerEdges: toggleEdge(dividerEdges, edge) });
        }
      }
    } else if (gesture.kind === 'grid') {
      const toggled = spanEdges(gesture);
      if (toggled.length > 0) {
        if (gesture.layer === 'perimeter') {
          updateConfig({ openEdges: toggled.reduce(toggleEdge, openEdges) });
        } else {
          updateConfig({ dividerEdges: toggled.reduce(toggleEdge, dividerEdges) });
        }
      }
    } else {
      const { draft } = gesture;
      const length = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
      if (length >= 5) {
        updateConfig({
          innerWalls: [...innerWalls, { ...draft, width: 1.2, height: null }],
        });
      }
    }
    setGesture(null);
  }

  function updateWall(i: number, patch: Partial<InnerWall>) {
    updateConfig({
      innerWalls: innerWalls.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    });
  }

  function removeWall(i: number) {
    updateConfig({ innerWalls: innerWalls.filter((_, j) => j !== i) });
    setSelectedWall((s) => (s == null || s < i ? s : s === i ? null : s - 1));
  }

  // The grid-drag preview mirrors the class of the state the edge will end in.
  const gridGesture = gesture?.kind === 'grid' ? gesture : null;
  const previewClass = gridGesture
    ? gridGesture.layer === 'perimeter'
      ? (gridGesture.adding ? 'edge-line--open' : 'edge-line--wall')
      : (gridGesture.adding ? 'edge-line--divider' : 'edge-line--ghost')
    : '';
  const draft = gesture?.kind === 'free' ? gesture.draft : null;

  return (
    <Stack className="no-select" gap="sm">
      <Hint>
        Click a grid edge to toggle it, or drag along a grid line to paint
        several: outer edges open the wall, inner edges add dividers. Drag
        anywhere else to draw a custom wall — endpoints snap to grid lines,
        intersections, and existing walls. Click a custom wall to select it;
        Delete removes it.
      </Hint>
      <EditorCanvas
        ref={svgRef}
        className="editor-svg editor-svg--walls"
        gridCols={gridCols}
        gridRows={gridRows}
        cells={cells}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        {edgeElements}
        {gridGesture && spanEdges(gridGesture).map((e) => (
          <line
            key={`p${edgeKey(e)}`}
            {...edgeEndpoints(e)}
            className={`edge-line ${previewClass} edge-drag-preview`}
          />
        ))}
        {innerWalls.map((w, i) => {
          const p = {
            x1: mmToSvg(w.x1), y1: mmToSvg(w.y1),
            x2: mmToSvg(w.x2), y2: mmToSvg(w.y2),
          };
          return (
            <g key={`w${i}`} className="custom-wall-g">
              <line {...p} className="custom-wall-hit" />
              <line
                {...p}
                className={`custom-wall${selectedWall === i ? ' custom-wall--selected' : ''}`}
                strokeWidth={Math.max(2.5, (w.width / GRID_PITCH) * CELL)}
              />
            </g>
          );
        })}
        {draft && (
          <g>
            <line
              className="custom-wall--draft"
              x1={mmToSvg(draft.x1)} y1={mmToSvg(draft.y1)}
              x2={mmToSvg(draft.x2)} y2={mmToSvg(draft.y2)}
            />
            <circle
              className="custom-wall-endpoint"
              cx={mmToSvg(draft.x1)} cy={mmToSvg(draft.y1)} r={4}
            />
            <circle
              className="custom-wall-endpoint"
              cx={mmToSvg(draft.x2)} cy={mmToSvg(draft.y2)} r={4}
            />
          </g>
        )}
      </EditorCanvas>
      <Group gap="md">
        {LEGEND.map(({ label, kind }) => (
          <Group key={label} gap={4} wrap="nowrap">
            <span className={`legend-swatch legend-swatch--${kind}`} />
            <Text>{label}</Text>
          </Group>
        ))}
      </Group>
      <Group>
        <Button
          variant="default"
          disabled={!hasOverrides}
          onClick={() => updateConfig({ openEdges: [], dividerEdges: [] })}
        >
          Reset grid walls
        </Button>
      </Group>

      {innerWalls.length > 0 && (
        <Stack gap="xs">
          <Label>Custom walls</Label>
          {innerWalls.map((w, i) => {
            const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
            const full = w.height == null;
            return (
              <Paper
                key={i}
                p={6}
                bg="dark.6"
                className={selectedWall === i ? 'wall-row--selected' : undefined}
                onClick={() => setSelectedWall(i)}
              >
                <Group gap="xs" wrap="nowrap">
                  <Text flex={1} c="bright">#{i + 1} · {length.toFixed(0)} mm</Text>
                  <Group gap={4} wrap="nowrap">
                    <Text>w</Text>
                    <NumberInput
                      w={WALL_DIMENSION_INPUT_WIDTH}
                      hideControls
                      min={0.4}
                      max={8}
                      step={0.2}
                      value={w.width}
                      onChange={(v) => {
                        const n = typeof v === 'number' ? v : parseFloat(v);
                        if (!isNaN(n)) updateWall(i, { width: n });
                      }}
                    />
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    <Text>h</Text>
                    <NumberInput
                      w={WALL_DIMENSION_INPUT_WIDTH}
                      hideControls
                      min={0.5}
                      max={Math.round(cavityDepth * 2) / 2}
                      step={0.5}
                      value={full ? '' : w.height ?? ''}
                      placeholder="full"
                      disabled={full}
                      onChange={(v) => {
                        const n = typeof v === 'number' ? v : parseFloat(v);
                        if (!isNaN(n)) updateWall(i, { height: n });
                      }}
                    />
                  </Group>
                  <Checkbox
                    label="full"
                    checked={full}
                    onChange={(e) => updateWall(i, {
                      height: e.currentTarget.checked ? null : Math.round(cavityDepth) / 2,
                    })}
                  />
                  <CloseButton
                    onClick={(e) => {
                      e.stopPropagation(); // don't re-select via the row's onClick
                      removeWall(i);
                    }}
                    aria-label={`Delete wall ${i + 1}`}
                  />
                </Group>
              </Paper>
            );
          })}
          <Hint>
            Lower walls ramp smoothly into taller walls they touch. Widths and
            heights are in mm; height is measured from the cavity floor.
          </Hint>
        </Stack>
      )}
    </Stack>
  );
}

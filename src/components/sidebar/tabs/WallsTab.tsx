import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, CloseButton, Group, NumberInput, Paper, SegmentedControl, Stack, Text,
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

const snapMm = (mm: number) => Math.round(mm * 2) / 2;

// Drawing aids: endpoints magnetize to grid lines within GRID_SNAP_MM, and the
// segment locks to 45° increments when the drag is within ANGLE_SNAP_DEG of one.
const GRID_SNAP_MM = 3;
const ANGLE_SNAP_RAD = (7 * Math.PI) / 180;

// Max perpendicular distance (mm) from the pointer to a grid line for a drag
// in grid mode to pick up the edge on that line.
const EDGE_PICK_MM = 8;

function gridSnap(mm: number): number {
  const line = Math.round(mm / GRID_PITCH) * GRID_PITCH;
  return Math.abs(mm - line) <= GRID_SNAP_MM ? line : snapMm(mm);
}

/** Endpoint for a draft from (x1,y1) toward p, with grid + 45° snapping. */
function snapEnd(x1: number, y1: number, p: { x: number; y: number }): { x2: number; y2: number } {
  let x = gridSnap(p.x), y = gridSnap(p.y);
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
type Mode = 'grid' | 'free';

interface GridDrag {
  layer: EdgeLayer;
  /** true = drag makes edges active (open / divider), false = drag clears them */
  adding: boolean;
  edges: Map<string, GridEdge>;
}

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
  const [mode, setMode] = useState<Mode>('grid');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [gridDrag, setGridDrag] = useState<GridDrag | null>(null);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);

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

  // Rendered edge overlay. Memoized so per-pointer-move renders (grid-drag and
  // free-draft state change on every move) don't reconcile the whole edge
  // layer. Perimeter edges toggle openEdges; internal toggle dividerEdges.
  // Toggling happens through the SVG-level grid-drag handlers, so edges carry
  // no click handlers of their own — the hit line only provides hover/cursor.
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

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    return pointerToMm(svgRef.current!, e);
  }

  /** Nearest existing grid edge within EDGE_PICK_MM of a whole-bin mm point. */
  function nearestEdge(p: { x: number; y: number }): { edge: GridEdge; layer: EdgeLayer } | null {
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

  // ── Grid mode: drag along grid lines paints/clears edges ──
  // Pencil semantics: the first edge touched decides the direction (activate
  // or clear), and the drag only collects edges whose state would change.
  function startGridDrag(e: React.PointerEvent) {
    const hit = nearestEdge(svgPoint(e));
    if (!hit) return;
    const activeSet = hit.layer === 'perimeter'
      ? new Set(openEdges.map(edgeKey))
      : new Set(dividerEdges.map(edgeKey));
    const adding = !activeSet.has(edgeKey(hit.edge));
    setGridDrag({ layer: hit.layer, adding, edges: new Map([[edgeKey(hit.edge), hit.edge]]) });
    setSelectedWall(null);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function moveGridDrag(e: React.PointerEvent) {
    if (!gridDrag) return;
    const hit = nearestEdge(svgPoint(e));
    if (!hit || hit.layer !== gridDrag.layer) return;
    const key = edgeKey(hit.edge);
    if (gridDrag.edges.has(key)) return;
    const activeSet = gridDrag.layer === 'perimeter'
      ? new Set(openEdges.map(edgeKey))
      : new Set(dividerEdges.map(edgeKey));
    if (activeSet.has(key) === gridDrag.adding) return; // already in target state
    setGridDrag({ ...gridDrag, edges: new Map(gridDrag.edges).set(key, hit.edge) });
  }

  function endGridDrag() {
    if (!gridDrag) return;
    const toggled = [...gridDrag.edges.values()];
    if (toggled.length > 0) {
      if (gridDrag.layer === 'perimeter') {
        updateConfig({ openEdges: toggled.reduce(toggleEdge, openEdges) });
      } else {
        updateConfig({ dividerEdges: toggled.reduce(toggleEdge, dividerEdges) });
      }
    }
    setGridDrag(null);
  }

  // ── Free mode: drag draws a custom wall at any angle ──
  function startDraw(e: React.PointerEvent) {
    const p = svgPoint(e);
    const x = gridSnap(p.x), y = gridSnap(p.y);
    setDraft({ x1: x, y1: y, x2: x, y2: y });
    setSelectedWall(null);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function moveDraw(e: React.PointerEvent) {
    if (!draft) return;
    setDraft({ ...draft, ...snapEnd(draft.x1, draft.y1, svgPoint(e)) });
  }

  function endDraw() {
    if (!draft) return;
    const length = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
    if (length >= 5) {
      updateConfig({
        innerWalls: [...innerWalls, { ...draft, width: 1.2, height: null }],
      });
    }
    setDraft(null);
  }

  function updateWall(i: number, patch: Partial<InnerWall>) {
    updateConfig({
      innerWalls: innerWalls.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    });
  }

  function removeWall(i: number) {
    updateConfig({ innerWalls: innerWalls.filter((_, j) => j !== i) });
    setSelectedWall((s) => (s === i ? null : s));
  }

  // The grid-drag preview mirrors the class of the state the edge will end in.
  const previewClass = gridDrag
    ? gridDrag.layer === 'perimeter'
      ? (gridDrag.adding ? 'edge-line--open' : 'edge-line--wall')
      : (gridDrag.adding ? 'edge-line--divider' : 'edge-line--ghost')
    : '';

  const grid = mode === 'grid';

  return (
    <Stack className="no-select" gap="sm">
      <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v as Mode)}
        data={[
          { value: 'grid', label: 'Grid walls' },
          { value: 'free', label: 'Free walls' },
        ]}
      />
      <Hint>
        {grid
          ? 'Click or drag along grid lines: outer edges open/close the wall, ' +
            'inner edges add dividers. The first edge sets whether a drag adds or clears.'
          : 'Drag inside a bin to draw a custom wall at any angle — endpoints snap ' +
            'to grid lines, and the wall snaps near 45° increments. Click a wall to ' +
            'select it; Delete removes it.'}
      </Hint>
      <EditorCanvas
        ref={svgRef}
        className={`editor-svg editor-svg--${mode}`}
        gridCols={gridCols}
        gridRows={gridRows}
        cells={cells}
        onPointerDown={grid ? startGridDrag : undefined}
        onPointerMove={grid ? moveGridDrag : moveDraw}
        onPointerUp={grid ? endGridDrag : endDraw}
      >
        {/* invisible catcher for free-wall drawing; edges render above it */}
        {!grid && (
          <rect
            width="100%" height="100%"
            fill="transparent"
            onPointerDown={startDraw}
          />
        )}
        {edgeElements}
        {gridDrag && [...gridDrag.edges.values()].map((e) => (
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
            <g
              key={`w${i}`}
              className="custom-wall-g"
              onPointerDown={(ev) => {
                ev.stopPropagation();
                setSelectedWall((s) => (s === i ? null : i));
              }}
            >
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
          <line
            className="custom-wall--draft"
            x1={mmToSvg(draft.x1)} y1={mmToSvg(draft.y1)}
            x2={mmToSvg(draft.x2)} y2={mmToSvg(draft.y2)}
          />
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
                    onClick={() => removeWall(i)}
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

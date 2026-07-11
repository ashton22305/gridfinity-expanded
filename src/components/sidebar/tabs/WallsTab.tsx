import { useMemo, useRef, useState } from 'react';
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

const snapMm = (mm: number) => Math.round(mm * 2) / 2;

// Drawing aids: endpoints magnetize to grid lines within GRID_SNAP_MM, and the
// segment locks to 45° increments when the drag is within ANGLE_SNAP_DEG of one.
const GRID_SNAP_MM = 3;
const ANGLE_SNAP_RAD = (7 * Math.PI) / 180;

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

/** Shared width for the compact wall width/height number fields. */
const WALL_DIMENSION_INPUT_WIDTH = 56;

const LEGEND = [
  { label: 'wall', kind: 'wall' },
  { label: 'open', kind: 'open' },
  { label: 'divider', kind: 'divider' },
  { label: 'custom', kind: 'custom' },
];

export function WallsTab() {
  const { config, updateConfig, gridCols, gridRows } = useAppStore();
  const { openEdges, dividerEdges, innerWalls } = config;
  const cells = flattenBins(config.bins);
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

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

  // Rendered edge overlay. Memoized so per-pointer-move draft renders (setDraft
  // fires on every move while drawing) don't reconcile the whole edge layer.
  // Perimeter edges toggle openEdges (wall removed); internal toggle dividerEdges.
  const edgeElements = useMemo(() => {
    const layers = [
      {
        edges: [...perimeter.values()],
        activeSet: new Set(openEdges.map(edgeKey)),
        toggle: (e: GridEdge) => updateConfig({ openEdges: toggleEdge(openEdges, e) }),
        activeClass: 'edge-line edge-line--open',   // wall removed
        inactiveClass: 'edge-line edge-line--wall', // solid wall
      },
      {
        edges: [...internal.values()],
        activeSet: new Set(dividerEdges.map(edgeKey)),
        toggle: (e: GridEdge) => updateConfig({ dividerEdges: toggleEdge(dividerEdges, e) }),
        activeClass: 'edge-line edge-line--divider', // divider
        inactiveClass: 'edge-line edge-line--ghost', // ghost
      },
    ];
    return layers.flatMap(({ edges, activeSet, toggle, activeClass, inactiveClass }) =>
      edges.map((e) => {
        const key = edgeKey(e);
        const p = edgeEndpoints(e);
        return (
          <g key={key} className="edge" onClick={() => toggle(e)}>
            <line {...p} stroke="transparent" strokeWidth={12} strokeLinecap="round" />
            <line {...p} className={activeSet.has(key) ? activeClass : inactiveClass} />
          </g>
        );
      }),
    );
  }, [perimeter, internal, openEdges, dividerEdges, updateConfig]);

  if (cells.length === 0) {
    return <Hint>Select cells in the Shape tab first.</Hint>;
  }

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    return pointerToMm(svgRef.current!, e);
  }

  function startDraw(e: React.PointerEvent) {
    const p = svgPoint(e);
    const x = gridSnap(p.x), y = gridSnap(p.y);
    setDraft({ x1: x, y1: y, x2: x, y2: y });
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
  }

  return (
    <Stack className="no-select" gap="sm">
      <Hint>
        Click outer edges to remove/restore walls, inner edges to add grid
        dividers. Drag inside a bin to draw a custom wall at any angle —
        endpoints snap to grid lines, and the wall snaps near 45° increments.
      </Hint>
      <EditorCanvas
        ref={svgRef}
        gridCols={gridCols}
        gridRows={gridRows}
        cells={cells}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
      >
        {/* invisible catcher for free-wall drawing; edges render above it */}
        <rect
          width="100%" height="100%"
          fill="transparent"
          onPointerDown={startDraw}
        />
        {edgeElements}
        {innerWalls.map((w, i) => (
          <line
            key={`w${i}`}
            className="custom-wall"
            x1={mmToSvg(w.x1)} y1={mmToSvg(w.y1)}
            x2={mmToSvg(w.x2)} y2={mmToSvg(w.y2)}
            strokeWidth={Math.max(2.5, (w.width / GRID_PITCH) * CELL)}
          />
        ))}
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
              <Paper key={i} p={6} bg="dark.6">
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

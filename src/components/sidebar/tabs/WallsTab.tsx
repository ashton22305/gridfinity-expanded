import { useMemo, useRef, useState } from 'react';
import type { GridEdge, InnerWall } from '../../../lib/types';
import {
  edgeKey, perimeterEdges, internalEdges, toggleEdge,
} from '../../../lib/edges';
import { groupBins } from '../../../lib/split';
import { GRID_PITCH, HEIGHT_PER_UNIT, FLOOR_THICKNESS } from '../../../lib/geometry/gridfinity';
import { useAppStore } from '../../../store';
import { EditorCanvas } from '../EditorCanvas';
import { CELL, gridToSvg, mmToSvg, pointerToMm } from '../editorCoords';
import { Hint, Label } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { NumberInput } from '../../ui/inputs';

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

const LEGEND = [
  { label: 'wall', swatch: 'bg-slate-400' },
  { label: 'open', swatch: 'bg-[repeating-linear-gradient(90deg,#52525b_0_3px,transparent_3px_6px)]' },
  { label: 'divider', swatch: 'bg-blue-600' },
  { label: 'custom', swatch: 'bg-teal-500' },
];

export function WallsTab() {
  const { config, updateConfig, gridCols, gridRows } = useAppStore();
  const { cells, openEdges, dividerEdges, innerWalls } = config;
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
    for (const b of groupBins(cells)) {
      for (const e of perimeterEdges(b.cells)) perimeter.set(edgeKey(e), e);
      for (const e of internalEdges(b.cells)) internal.set(edgeKey(e), e);
    }
    return { perimeter, internal };
  }, [cells]);

  // Rendered edge overlay. Memoized so per-pointer-move draft renders (setDraft
  // fires on every move while drawing) don't reconcile the whole edge layer.
  // Perimeter edges toggle openEdges (wall removed); internal toggle dividerEdges.
  const edgeElements = useMemo(() => {
    const layers = [
      {
        edges: [...perimeter.values()],
        activeSet: new Set(openEdges.map(edgeKey)),
        toggle: (e: GridEdge) => updateConfig({ openEdges: toggleEdge(openEdges, e) }),
        activeClass: 'stroke-zinc-600 [stroke-width:2] [stroke-dasharray:4_5] group-hover:stroke-zinc-500',  // open
        inactiveClass: 'stroke-slate-400 [stroke-width:4] group-hover:stroke-slate-300',                     // solid wall
      },
      {
        edges: [...internal.values()],
        activeSet: new Set(dividerEdges.map(edgeKey)),
        toggle: (e: GridEdge) => updateConfig({ dividerEdges: toggleEdge(dividerEdges, e) }),
        activeClass: 'stroke-blue-600 [stroke-width:4] group-hover:stroke-blue-500',  // divider
        inactiveClass: 'stroke-zinc-700 [stroke-width:1.5] [stroke-dasharray:2_4] group-hover:stroke-blue-600 group-hover:[stroke-width:3]',  // ghost
      },
    ];
    return layers.flatMap(({ edges, activeSet, toggle, activeClass, inactiveClass }) =>
      edges.map((e) => {
        const key = edgeKey(e);
        const p = edgeEndpoints(e);
        return (
          <g key={key} className="group cursor-pointer" onClick={() => toggle(e)}>
            <line {...p} stroke="transparent" strokeWidth={12} strokeLinecap="round" />
            <line
              {...p}
              className={`pointer-events-none ${activeSet.has(key) ? activeClass : inactiveClass}`}
              strokeLinecap="round"
            />
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
    <div className="flex flex-col gap-3 select-none">
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
            className="pointer-events-none stroke-teal-500"
            x1={mmToSvg(w.x1)} y1={mmToSvg(w.y1)}
            x2={mmToSvg(w.x2)} y2={mmToSvg(w.y2)}
            strokeWidth={Math.max(2.5, (w.width / GRID_PITCH) * CELL)}
            strokeLinecap="round"
          />
        ))}
        {draft && (
          <line
            className="pointer-events-none stroke-teal-400"
            x1={mmToSvg(draft.x1)} y1={mmToSvg(draft.y1)}
            x2={mmToSvg(draft.x2)} y2={mmToSvg(draft.y2)}
            strokeWidth={3} strokeDasharray="5 4" strokeLinecap="round"
          />
        )}
      </EditorCanvas>
      <div className="flex flex-wrap items-center gap-3.5 text-xs text-zinc-500">
        {LEGEND.map(({ label, swatch }) => (
          <span key={label} className="inline-flex items-center gap-1">
            <i className={`inline-block h-[3px] w-4 rounded-sm ${swatch}`} /> {label}
          </span>
        ))}
      </div>
      <Button
        className="self-start px-3 py-1 text-[0.8rem]"
        disabled={!hasOverrides}
        onClick={() => updateConfig({ openEdges: [], dividerEdges: [] })}
      >
        Reset grid walls
      </Button>

      {innerWalls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label>Custom walls</Label>
          {innerWalls.map((w, i) => {
            const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
            const full = w.height == null;
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md bg-zinc-800/70 px-2 py-1 text-xs text-zinc-400"
              >
                <span className="flex-1 text-zinc-300">#{i + 1} · {length.toFixed(0)} mm</span>
                <label className="inline-flex items-center gap-1">
                  w
                  <NumberInput
                    min={0.4}
                    max={8}
                    step={0.2}
                    value={w.width}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateWall(i, { width: v });
                    }}
                    className="w-[46px] px-1 py-0.5 text-xs"
                  />
                </label>
                <label className="inline-flex items-center gap-1">
                  h
                  <NumberInput
                    min={0.5}
                    max={Math.round(cavityDepth * 2) / 2}
                    step={0.5}
                    value={full ? '' : w.height ?? ''}
                    placeholder="full"
                    disabled={full}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateWall(i, { height: v });
                    }}
                    className="w-[46px] px-1 py-0.5 text-xs"
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={full}
                    onChange={(e) => updateWall(i, {
                      height: e.target.checked ? null : Math.round(cavityDepth) / 2,
                    })}
                  />
                  full
                </label>
                <button
                  className="rounded px-1.5 text-[0.95rem] text-red-400 hover:bg-red-950/60"
                  onClick={() => removeWall(i)}
                  aria-label={`Delete wall ${i + 1}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          <Hint>
            Lower walls ramp smoothly into taller walls they touch. Widths and
            heights are in mm; height is measured from the cavity floor.
          </Hint>
        </div>
      )}
    </div>
  );
}

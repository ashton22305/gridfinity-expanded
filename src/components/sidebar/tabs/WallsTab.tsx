import { useRef, useState } from 'react';
import type { BinConfig, GridEdge, InnerWall } from '../../../lib/types';
import {
  edgeKey, sortEdges, perimeterEdges, internalEdges,
} from '../../../lib/edges';
import { groupBins } from '../../../lib/split';
import { GRID_PITCH, HEIGHT_PER_UNIT, FLOOR_THICKNESS } from '../../../lib/geometry/gridfinity';
import { binColor } from '../binColors';
import styles from './WallsTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
  gridCols: number;
  gridRows: number;
}

const CELL = 40;   // svg units per cell
const PAD = 8;

const mmToSvg = (mm: number) => PAD + (mm / GRID_PITCH) * CELL;
const svgToMm = (u: number) => ((u - PAD) / CELL) * GRID_PITCH;
const snapMm = (mm: number) => Math.round(mm * 2) / 2;

function edgeEndpoints(e: GridEdge): { x1: number; y1: number; x2: number; y2: number } {
  const x = PAD + e.x * CELL;
  const y = PAD + e.y * CELL;
  return e.orientation === 'h'
    ? { x1: x, y1: y, x2: x + CELL, y2: y }
    : { x1: x, y1: y, x2: x, y2: y + CELL };
}

function toggleEdge(edges: GridEdge[], e: GridEdge): GridEdge[] {
  const key = edgeKey(e);
  const without = edges.filter((x) => edgeKey(x) !== key);
  return sortEdges(without.length === edges.length ? [...edges, e] : without);
}

interface Draft { x1: number; y1: number; x2: number; y2: number }

export function WallsTab({ config, onChange, gridCols, gridRows }: Props) {
  const { cells, openEdges, dividerEdges, innerWalls } = config;
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const openSet = new Set(openEdges.map(edgeKey));
  const dividerSet = new Set(dividerEdges.map(edgeKey));
  const hasOverrides = openEdges.length > 0 || dividerEdges.length > 0;
  const cavityDepth = HEIGHT_PER_UNIT * config.heightUnits - FLOOR_THICKNESS;

  // Multi-bin classification: an edge between two different bins is a
  // perimeter edge of BOTH bins (a real double wall); internal edges exist
  // only within a single bin.
  const bins = groupBins(cells);
  const perimeter = new Map<string, GridEdge>();
  const internal = new Map<string, GridEdge>();
  for (const b of bins) {
    for (const e of perimeterEdges(b.cells)) perimeter.set(edgeKey(e), e);
    for (const e of internalEdges(b.cells)) internal.set(edgeKey(e), e);
  }

  if (cells.length === 0) {
    return (
      <div className={styles.tab}>
        <p className={styles.hint}>Select cells in the Shape tab first.</p>
      </div>
    );
  }

  const viewW = gridCols * CELL + PAD * 2;
  const viewH = gridRows * CELL + PAD * 2;

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: snapMm(svgToMm(((e.clientX - rect.left) / rect.width) * viewW)),
      y: snapMm(svgToMm(((e.clientY - rect.top) / rect.height) * viewH)),
    };
  }

  function startDraw(e: React.PointerEvent) {
    const p = svgPoint(e);
    setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function moveDraw(e: React.PointerEvent) {
    if (!draft) return;
    const p = svgPoint(e);
    setDraft({ ...draft, x2: p.x, y2: p.y });
  }

  function endDraw() {
    if (!draft) return;
    const length = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1);
    if (length >= 5) {
      onChange({
        ...config,
        innerWalls: [...innerWalls, { ...draft, width: 1.2, height: null }],
      });
    }
    setDraft(null);
  }

  function updateWall(i: number, patch: Partial<InnerWall>) {
    onChange({
      ...config,
      innerWalls: innerWalls.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    });
  }

  function removeWall(i: number) {
    onChange({ ...config, innerWalls: innerWalls.filter((_, j) => j !== i) });
  }

  return (
    <div className={styles.tab}>
      <p className={styles.hint}>
        Click outer edges to remove/restore walls, inner edges to add grid
        dividers. Drag inside a bin to draw a custom wall at any angle.
      </p>
      <svg
        ref={svgRef}
        className={styles.editor}
        viewBox={`0 0 ${viewW} ${viewH}`}
        style={{ aspectRatio: `${viewW} / ${viewH}` }}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
      >
        {Array.from({ length: gridRows }, (_, row) =>
          Array.from({ length: gridCols }, (_, col) => (
            <rect
              key={`bg${col},${row}`}
              className={styles.bgRect}
              x={PAD + col * CELL + 2}
              y={PAD + row * CELL + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={3}
            />
          ))
        )}
        {cells.map((c) => (
          <rect
            key={`c${c.x},${c.y}`}
            className={styles.cellRect}
            style={{ fill: binColor(c.bin), fillOpacity: 0.22 }}
            x={PAD + c.x * CELL}
            y={PAD + c.y * CELL}
            width={CELL}
            height={CELL}
          />
        ))}
        {/* invisible catcher for free-wall drawing; edges render above it */}
        <rect
          x={0} y={0} width={viewW} height={viewH}
          fill="transparent"
          onPointerDown={startDraw}
        />
        {[...perimeter.values()].map((e) => {
          const p = edgeEndpoints(e);
          const isOpen = openSet.has(edgeKey(e));
          return (
            <g
              key={edgeKey(e)}
              className={styles.edgeHit}
              onClick={() => onChange({ ...config, openEdges: toggleEdge(openEdges, e) })}
            >
              <line {...p} className={styles.hitLine} />
              <line {...p} className={isOpen ? styles.openWall : styles.wall} />
            </g>
          );
        })}
        {[...internal.values()].map((e) => {
          const p = edgeEndpoints(e);
          const isDivider = dividerSet.has(edgeKey(e));
          return (
            <g
              key={edgeKey(e)}
              className={styles.edgeHit}
              onClick={() => onChange({ ...config, dividerEdges: toggleEdge(dividerEdges, e) })}
            >
              <line {...p} className={styles.hitLine} />
              <line {...p} className={isDivider ? styles.divider : styles.ghostDivider} />
            </g>
          );
        })}
        {innerWalls.map((w, i) => (
          <line
            key={`w${i}`}
            className={styles.innerWall}
            x1={mmToSvg(w.x1)} y1={mmToSvg(w.y1)}
            x2={mmToSvg(w.x2)} y2={mmToSvg(w.y2)}
            strokeWidth={Math.max(2.5, (w.width / GRID_PITCH) * CELL)}
          />
        ))}
        {draft && (
          <line
            className={styles.draftWall}
            x1={mmToSvg(draft.x1)} y1={mmToSvg(draft.y1)}
            x2={mmToSvg(draft.x2)} y2={mmToSvg(draft.y2)}
          />
        )}
      </svg>
      <div className={styles.legend}>
        <span><i className={styles.swatchWall} /> wall</span>
        <span><i className={styles.swatchOpen} /> open</span>
        <span><i className={styles.swatchDivider} /> divider</span>
        <span><i className={styles.swatchInner} /> custom</span>
      </div>
      <button
        className={styles.resetButton}
        disabled={!hasOverrides}
        onClick={() => onChange({ ...config, openEdges: [], dividerEdges: [] })}
      >
        Reset grid walls
      </button>

      {innerWalls.length > 0 && (
        <div className={styles.wallList}>
          <span className={styles.listTitle}>Custom walls</span>
          {innerWalls.map((w, i) => {
            const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
            const full = w.height == null;
            return (
              <div key={i} className={styles.wallRow}>
                <span className={styles.wallLen}>#{i + 1} · {length.toFixed(0)} mm</span>
                <label className={styles.wallField}>
                  w
                  <input
                    type="number"
                    min={0.4}
                    max={8}
                    step={0.2}
                    value={w.width}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateWall(i, { width: v });
                    }}
                    className={styles.wallInput}
                  />
                </label>
                <label className={styles.wallField}>
                  h
                  <input
                    type="number"
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
                    className={styles.wallInput}
                  />
                </label>
                <label className={styles.wallFull}>
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
                  className={styles.wallDelete}
                  onClick={() => removeWall(i)}
                  aria-label={`Delete wall ${i + 1}`}
                >
                  ×
                </button>
              </div>
            );
          })}
          <p className={styles.hint}>
            Lower walls ramp smoothly into taller walls they touch. Widths and
            heights are in mm; height is measured from the cavity floor.
          </p>
        </div>
      )}
    </div>
  );
}

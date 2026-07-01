import type { BinConfig, GridEdge } from '../../../lib/types';
import {
  edgeKey, sortEdges, perimeterEdges, internalEdges, effectiveWalls,
} from '../../../lib/edges';
import styles from './WallsTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
}

const GRID_COLS = 6;
const GRID_ROWS = 6;
const CELL = 40;   // svg units per cell
const PAD = 8;

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

export function WallsTab({ config, onChange }: Props) {
  const { cells, openEdges, dividerEdges } = config;
  const walls = effectiveWalls(cells, cells, openEdges, dividerEdges);
  const openSet = new Set(walls.open.map(edgeKey));
  const dividerSet = new Set(walls.dividers.map(edgeKey));
  const hasOverrides = openEdges.length > 0 || dividerEdges.length > 0;

  if (cells.length === 0) {
    return (
      <div className={styles.tab}>
        <p className={styles.hint}>Select cells in the Shape tab first.</p>
      </div>
    );
  }

  return (
    <div className={styles.tab}>
      <p className={styles.hint}>
        Click outer edges to remove/restore walls (open bins for multi-part
        prints). Click inner edges to add/remove divider walls.
      </p>
      <svg
        className={styles.editor}
        viewBox={`0 0 ${GRID_COLS * CELL + PAD * 2} ${GRID_ROWS * CELL + PAD * 2}`}
      >
        {Array.from({ length: GRID_ROWS }, (_, row) =>
          Array.from({ length: GRID_COLS }, (_, col) => (
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
        {cells.map(({ x, y }) => (
          <rect
            key={`c${x},${y}`}
            className={styles.cellRect}
            x={PAD + x * CELL}
            y={PAD + y * CELL}
            width={CELL}
            height={CELL}
          />
        ))}
        {perimeterEdges(cells).map((e) => {
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
        {internalEdges(cells).map((e) => {
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
      </svg>
      <div className={styles.legend}>
        <span><i className={styles.swatchWall} /> wall</span>
        <span><i className={styles.swatchOpen} /> open</span>
        <span><i className={styles.swatchDivider} /> divider</span>
      </div>
      <button
        className={styles.resetButton}
        disabled={!hasOverrides}
        onClick={() => onChange({ ...config, openEdges: [], dividerEdges: [] })}
      >
        Reset walls
      </button>
    </div>
  );
}

import { useState } from 'react';
import type { BinConfig, GridCell } from '../../../lib/types';
import { GRID_PITCH } from '../../../lib/geometry/gridfinity';
import { getGridFootprintCells } from '../../../lib/printers';
import styles from './ShapeTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
}

const GRID_COLS = 6;
const GRID_ROWS = 6;

function cellKey(c: GridCell) {
  return `${c.x},${c.y}`;
}

export function ShapeTab({ config, onChange }: Props) {
  const selected = new Set(config.cells.map(cellKey));

  // Track pointer-drag state so users can paint by holding the mouse.
  const [paintMode, setPaintMode] = useState<'add' | 'remove' | null>(null);

  function toggleCell(x: number, y: number) {
    const key = `${x},${y}`;
    if (selected.has(key)) {
      onChange({ ...config, cells: config.cells.filter((c) => cellKey(c) !== key) });
    } else {
      onChange({ ...config, cells: [...config.cells, { x, y }] });
    }
  }

  function handlePointerDown(x: number, y: number) {
    const key = `${x},${y}`;
    const mode = selected.has(key) ? 'remove' : 'add';
    setPaintMode(mode);
    toggleCell(x, y);
  }

  function handlePointerEnter(x: number, y: number) {
    if (!paintMode) return;
    const key = `${x},${y}`;
    const isSelected = selected.has(key);
    if (paintMode === 'add' && !isSelected) toggleCell(x, y);
    if (paintMode === 'remove' && isSelected) toggleCell(x, y);
  }

  function handlePointerUp() {
    setPaintMode(null);
  }

  const cells = config.cells;
  const { widthCells, depthCells } = getGridFootprintCells(cells);

  return (
    <div
      className={styles.shapeTab}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <p className={styles.hint}>Click or drag to toggle grid cells</p>
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
      >
        {Array.from({ length: GRID_ROWS }, (_, row) =>
          Array.from({ length: GRID_COLS }, (_, col) => {
            const isSelected = selected.has(`${col},${row}`);
            return (
              <button
                key={`${col}-${row}`}
                className={`${styles.cell} ${isSelected ? styles.selected : ''}`}
                onPointerDown={() => handlePointerDown(col, row)}
                onPointerEnter={() => handlePointerEnter(col, row)}
                aria-label={`Cell ${col},${row}`}
                aria-pressed={isSelected}
              />
            );
          })
        )}
      </div>
      <div className={styles.stats}>
        <span>{cells.length} cell{cells.length !== 1 ? 's' : ''}</span>
        {cells.length > 0 && (
          <span>
            {widthCells * GRID_PITCH} × {depthCells * GRID_PITCH} mm footprint
          </span>
        )}
      </div>
    </div>
  );
}

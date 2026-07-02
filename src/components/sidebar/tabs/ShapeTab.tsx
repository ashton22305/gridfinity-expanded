import { useState } from 'react';
import type { BinConfig } from '../../../lib/types';
import { GRID_PITCH } from '../../../lib/geometry/gridfinity';
import { getGridFootprintCells } from '../../../lib/printers';
import { groupBins } from '../../../lib/split';
import { binColor } from '../binColors';
import styles from './ShapeTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
  gridCols: number;
  gridRows: number;
  onGridSizeChange: (cols: number, rows: number) => void;
}

export const MAX_GRID = 40;

function cellKey(c: { x: number; y: number }) {
  return `${c.x},${c.y}`;
}

export function ShapeTab({ config, onChange, gridCols, gridRows, onGridSizeChange }: Props) {
  const cellBin = new Map(config.cells.map((c) => [cellKey(c), c.bin ?? 0]));
  const bins = groupBins(config.cells);
  const [activeBin, setActiveBin] = useState(0);

  // Track pointer-drag state so users can paint by holding the mouse.
  const [paintMode, setPaintMode] = useState<'add' | 'remove' | null>(null);

  // Bin ids offered for painting: every used id plus one fresh one.
  const usedIds = bins.map((b) => b.id);
  const nextId = usedIds.length ? Math.max(...usedIds) + 1 : 0;
  const paletteIds = [...new Set([...usedIds, Math.min(nextId, 7)])].sort((a, b) => a - b);

  function assignCell(x: number, y: number) {
    const key = `${x},${y}`;
    if (cellBin.get(key) === activeBin) return;
    onChange({
      ...config,
      cells: [...config.cells.filter((c) => cellKey(c) !== key), { x, y, bin: activeBin }],
    });
  }

  function removeCell(x: number, y: number) {
    const key = `${x},${y}`;
    if (!cellBin.has(key)) return;
    onChange({ ...config, cells: config.cells.filter((c) => cellKey(c) !== key) });
  }

  function handlePointerDown(x: number, y: number) {
    if (cellBin.get(`${x},${y}`) === activeBin) {
      setPaintMode('remove');
      removeCell(x, y);
    } else {
      setPaintMode('add');
      assignCell(x, y);
    }
  }

  function handlePointerEnter(x: number, y: number) {
    if (paintMode === 'add') assignCell(x, y);
    if (paintMode === 'remove') removeCell(x, y);
  }

  const cells = config.cells;
  const { widthCells, depthCells } = getGridFootprintCells(cells);
  const minCols = Math.max(4, ...cells.map((c) => c.x + 1));
  const minRows = Math.max(4, ...cells.map((c) => c.y + 1));

  function changeSize(cols: number, rows: number) {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    onGridSizeChange(
      Math.min(MAX_GRID, Math.max(minCols, Math.round(cols))),
      Math.min(MAX_GRID, Math.max(minRows, Math.round(rows))),
    );
  }

  return (
    <div
      className={styles.shapeTab}
      onPointerUp={() => setPaintMode(null)}
      onPointerLeave={() => setPaintMode(null)}
    >
      <div className={styles.sizeRow}>
        <span className={styles.label}>Grid</span>
        <input
          type="number"
          min={minCols}
          max={MAX_GRID}
          value={gridCols}
          onChange={(e) => changeSize(Number(e.target.value), gridRows)}
          className={styles.sizeInput}
          aria-label="Grid columns"
        />
        <span className={styles.times}>×</span>
        <input
          type="number"
          min={minRows}
          max={MAX_GRID}
          value={gridRows}
          onChange={(e) => changeSize(gridCols, Number(e.target.value))}
          className={styles.sizeInput}
          aria-label="Grid rows"
        />
        <span className={styles.times}>cells</span>
      </div>

      <div className={styles.binRow}>
        {paletteIds.map((id) => (
          <button
            key={id}
            className={`${styles.binButton} ${activeBin === id ? styles.binActive : ''}`}
            style={{ '--bin-color': binColor(id) } as React.CSSProperties}
            onClick={() => setActiveBin(id)}
            title={usedIds.includes(id) ? `Paint bin ${id + 1}` : 'Start a new bin'}
          >
            <i className={styles.binSwatch} />
            {usedIds.includes(id) ? `Bin ${id + 1}` : '+ New'}
          </button>
        ))}
      </div>

      <p className={styles.hint}>
        Click or drag to toggle cells for the selected bin. Adjacent bins are
        printed as separate, complete bins.
      </p>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          aspectRatio: `${gridCols} / ${gridRows}`,
          gap: gridCols > 14 || gridRows > 14 ? 1 : gridCols > 8 ? 2 : 4,
        }}
      >
        {Array.from({ length: gridRows }, (_, row) =>
          Array.from({ length: gridCols }, (_, col) => {
            const bin = cellBin.get(`${col},${row}`);
            const isSelected = bin !== undefined;
            return (
              <button
                key={`${col}-${row}`}
                className={`${styles.cell} ${isSelected ? styles.selected : ''}`}
                style={isSelected ? { background: binColor(bin), borderColor: binColor(bin) } : undefined}
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
        <span>
          {cells.length} cell{cells.length !== 1 ? 's' : ''}
          {bins.length > 1 ? ` in ${bins.length} bins` : ''}
        </span>
        {cells.length > 0 && (
          <span>
            {widthCells * GRID_PITCH} × {depthCells * GRID_PITCH} mm footprint
          </span>
        )}
      </div>
    </div>
  );
}

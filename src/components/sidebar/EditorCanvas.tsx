import { useMemo, type ComponentProps } from 'react';
import type { GridCell } from '../../lib/types';
import { binColor } from './binColors';
import { CELL, PAD } from './editorCoords';

interface EditorCanvasProps extends ComponentProps<'svg'> {
  gridCols: number;
  gridRows: number;
  cells: GridCell[];
}

/**
 * Base layer of the grid editors: the empty-grid background and the selected
 * cells tinted by bin color. Overlays (edges, walls, split lines) render as
 * children on top. Both layers are memoized — consumers re-render on every
 * pointer move while drawing, and the background alone is up to 1600 rects.
 */
export function EditorCanvas({ gridCols, gridRows, cells, children, ...svgProps }: EditorCanvasProps) {
  const viewW = gridCols * CELL + PAD * 2;
  const viewH = gridRows * CELL + PAD * 2;

  const background = useMemo(
    () =>
      Array.from({ length: gridRows }, (_, row) =>
        Array.from({ length: gridCols }, (_, col) => (
          <rect
            key={`bg${col},${row}`}
            className="fill-zinc-800/70"
            x={PAD + col * CELL + 2}
            y={PAD + row * CELL + 2}
            width={CELL - 4}
            height={CELL - 4}
            rx={3}
          />
        ))
      ),
    [gridCols, gridRows]
  );

  const cellLayer = useMemo(
    () =>
      cells.map((c) => (
        <rect
          key={`c${c.x},${c.y}`}
          fill={binColor(c.bin)}
          fillOpacity={0.22}
          x={PAD + c.x * CELL}
          y={PAD + c.y * CELL}
          width={CELL}
          height={CELL}
        />
      )),
    [cells]
  );

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      className="w-full touch-none"
      style={{ aspectRatio: `${viewW} / ${viewH}` }}
      {...svgProps}
    >
      {background}
      {cellLayer}
      {children}
    </svg>
  );
}

// Pure split-line partitioning. Split lines sit on integer grid coordinates and
// slice the cell set into pieces; each piece is generated as an independent bin.
import type { GridCell, SplitLine } from './types';

export interface Piece {
  col: number;  // chunk index along x (0-based)
  row: number;  // chunk index along y
  cells: GridCell[];
}

function chunkIndex(coord: number, sortedLines: number[]): number {
  let i = 0;
  while (i < sortedLines.length && coord >= sortedLines[i]) i++;
  return i;
}

/** Unique, sorted line indices for one axis. */
export function axisLines(splitLines: SplitLine[], axis: 'x' | 'y'): number[] {
  return [...new Set(splitLines.filter((l) => l.axis === axis).map((l) => l.index))]
    .sort((a, b) => a - b);
}

/** Partitions cells by the split lines. Empty pieces are omitted. */
export function partitionCells(cells: GridCell[], splitLines: SplitLine[]): Piece[] {
  const xLines = axisLines(splitLines, 'x');
  const yLines = axisLines(splitLines, 'y');
  if (xLines.length === 0 && yLines.length === 0) {
    return cells.length ? [{ col: 0, row: 0, cells }] : [];
  }

  const byChunk = new Map<string, Piece>();
  for (const c of cells) {
    const col = chunkIndex(c.x, xLines);
    const row = chunkIndex(c.y, yLines);
    const key = `${col},${row}`;
    let piece = byChunk.get(key);
    if (!piece) {
      piece = { col, row, cells: [] };
      byChunk.set(key, piece);
    }
    piece.cells.push(c);
  }

  return [...byChunk.values()].sort((a, b) => a.row - b.row || a.col - b.col);
}

export function sortSplitLines(lines: SplitLine[]): SplitLine[] {
  return [...lines].sort((a, b) => a.axis.localeCompare(b.axis) || a.index - b.index);
}

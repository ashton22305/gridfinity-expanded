import type { BinDesign, Cell, Cut, Edge, GridPoint, Point2, Wall } from './types';

/** Editor rows increase down; model Y increases up. */
export function editorPointToModel(point: Point2): Point2 {
  return { x: point.x, y: -point.y };
}

/** A row-down editor cell occupies the corresponding row-up model square. */
export function editorCellToModel(cell: Cell): Cell {
  return { x: cell.x, y: -cell.y - 1 };
}

export function editorGridPointToModel(point: GridPoint): GridPoint {
  return editorPointToModel(point);
}

export function editorEdgeToModel(edge: Edge): Edge {
  return edge.orientation === 'h'
    ? { ...edge, y: -edge.y }
    : { ...edge, y: -edge.y - 1 };
}

export function editorWallToModel(wall: Wall): Wall {
  return {
    ...wall,
    start: editorPointToModel(wall.start),
    end: editorPointToModel(wall.end),
  };
}

export function editorCutToModel(cut: Cut): Cut {
  return {
    start: editorGridPointToModel(cut.start),
    end: editorGridPointToModel(cut.end),
  };
}

export function editorBinToModel(bin: BinDesign): BinDesign {
  return {
    ...bin,
    cells: bin.cells.map(editorCellToModel),
    openings: bin.openings.map(editorEdgeToModel),
    walls: bin.walls.map(editorWallToModel),
    cuts: bin.cuts.map(editorCutToModel),
  };
}

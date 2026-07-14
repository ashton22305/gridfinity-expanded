import { partitionCells } from './cuts';
import { gridfinityHeight, IMPLEMENTATION_ALLOWANCES } from './gridfinitySpec';
import type { Cell, Cut, Design, GeometryInput, Point2 } from './types';

export function previewOffsetFor(cells: Cell[], cuts: Cut[], partCount: number): Point2 {
  if (partCount <= 1) return { x: 0, y: 0 };
  const halfGap = IMPLEMENTATION_ALLOWANCES.multipartPreviewGap / 2;
  const verticalLines = new Set<number>();
  const horizontalLines = new Set<number>();
  for (const cut of cuts) {
    if (cut.start.x === cut.end.x) verticalLines.add(cut.start.x);
    else horizontalLines.add(cut.start.y);
  }
  let x = 0;
  let y = 0;
  for (const line of verticalLines) {
    if (cells.every((cell) => cell.x < line)) x -= halfGap;
    else if (cells.every((cell) => cell.x >= line)) x += halfGap;
  }
  for (const line of horizontalLines) {
    if (cells.every((cell) => cell.y < line)) y -= halfGap;
    else if (cells.every((cell) => cell.y >= line)) y += halfGap;
  }
  return { x, y };
}

/** Convert editable UI state into complete, trusted geometry input. */
export function buildGeometryInput(design: Design): GeometryInput {
  return {
    height: gridfinityHeight(design.heightUnits),
    perimeterThickness: design.perimeterThickness,
    filletRadius: design.filletRadius,
    fasteners: design.fasteners,
    bins: design.bins.map((bin) => {
      const parts = partitionCells(bin.cells, bin.cuts).map((part) => part.cells);
      return {
        cells: bin.cells,
        openings: bin.openings,
        walls: bin.walls,
        parts,
        previewOffsets: parts.map((cells) => previewOffsetFor(cells, bin.cuts, parts.length)),
      };
    }),
  };
}

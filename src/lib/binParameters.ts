import { partitionCells } from './cuts';
import { gridfinityHeight } from './gridfinitySpec';
import type { BinParameters, Design } from './types';

/** Convert a validated design into self-contained per-bin generation parameters. */
export function buildBinParameters(design: Design): BinParameters[] {
  const height = gridfinityHeight(design.heightUnits);
  return design.bins.map((bin) => ({
    binId: bin.id,
    height,
    perimeterThickness: design.perimeterThickness,
    filletRadius: design.filletRadius,
    fasteners: design.fasteners,
    cells: bin.cells,
    openings: bin.openings,
    walls: bin.walls,
    pieces: partitionCells(bin.cells, bin.cuts).map((piece) => piece.cells),
  }));
}

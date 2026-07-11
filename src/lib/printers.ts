import type { GridCell, LogicalBin, PrinterProfile, BedFitResult, SplitLine } from './types';
import { GRID_PITCH } from './geometry/gridfinity';
import { partitionCells, sortSplitLines } from './split';

export const PRINTER_PROFILES: PrinterProfile[] = [
  { name: 'Bambu Lab A1 Mini', bedWidth: 180, bedDepth: 180 },
  { name: 'Bambu Lab P1S / X1C', bedWidth: 256, bedDepth: 256 },
  { name: 'Creality Ender 3 / V2', bedWidth: 220, bedDepth: 220 },
  { name: 'Creality K1', bedWidth: 220, bedDepth: 220 },
  { name: 'Elegoo Centauri Carbon / Carbon 2', bedWidth: 256, bedDepth: 256 },
  { name: 'Prusa MK4 / MK3S+', bedWidth: 250, bedDepth: 210 },
  { name: 'Prusa Mini+', bedWidth: 180, bedDepth: 180 },
  { name: 'Voron 2.4 (250mm)', bedWidth: 250, bedDepth: 250 },
  { name: 'Voron 2.4 (300mm)', bedWidth: 300, bedDepth: 300 },
  { name: 'Custom', bedWidth: 220, bedDepth: 220 },
];

const BED_MARGIN = 5; // mm clearance around part on bed

export function getGridFootprintCells(cells: GridCell[]): {
  widthCells: number;
  depthCells: number;
} {
  if (cells.length === 0) return { widthCells: 0, depthCells: 0 };

  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  return {
    widthCells: Math.max(...xs) - Math.min(...xs) + 1,
    depthCells: Math.max(...ys) - Math.min(...ys) + 1,
  };
}

export function checkBedFit(
  cells: GridCell[],
  printer: PrinterProfile
): BedFitResult {
  const { widthCells, depthCells } = getGridFootprintCells(cells);
  const binWidth = widthCells * GRID_PITCH;
  const binDepth = depthCells * GRID_PITCH;
  const normal = binWidth + BED_MARGIN * 2 <= printer.bedWidth &&
    binDepth + BED_MARGIN * 2 <= printer.bedDepth;
  const rotated = binDepth + BED_MARGIN * 2 <= printer.bedWidth &&
    binWidth + BED_MARGIN * 2 <= printer.bedDepth;

  return {
    fits: normal || rotated,
    binWidth,
    binDepth,
    rotated: !normal && rotated,
  };
}

/** Largest bin span (in cells) that fits one bed axis, honoring the margin. */
function maxCellsForBed(bedSize: number): number {
  return Math.floor((bedSize - BED_MARGIN * 2) / GRID_PITCH);
}

function axisSplitIndices(min: number, spanCells: number, maxCells: number): number[] {
  if (maxCells >= spanCells) return [];
  // maxCells === 0: bin can never fit — split maximally and let checkPieceFit warn.
  const chunks = maxCells > 0 ? Math.ceil(spanCells / maxCells) : spanCells;
  const n = Math.min(chunks, spanCells);
  return Array.from({ length: n - 1 }, (_, i) =>
    min + Math.round(((i + 1) * spanCells) / n));
}

/**
 * Grid-line split positions that cut the bin into the fewest evenly-sized
 * pieces that each fit the printer bed.
 */
export function computeAutoSplitLines(
  cells: GridCell[],
  printer: PrinterProfile,
): SplitLine[] {
  if (cells.length === 0) return [];
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const { widthCells, depthCells } = getGridFootprintCells(cells);

  const candidate = (bedWidth: number, bedDepth: number): SplitLine[] => sortSplitLines([
    ...axisSplitIndices(minX, widthCells, maxCellsForBed(bedWidth))
      .map((index): SplitLine => ({ axis: 'x', index })),
    ...axisSplitIndices(minY, depthCells, maxCellsForBed(bedDepth))
      .map((index): SplitLine => ({ axis: 'y', index })),
  ]);
  const plans = [
    candidate(printer.bedWidth, printer.bedDepth),
    candidate(printer.bedDepth, printer.bedWidth),
  ];
  const score = (lines: SplitLine[]): [number, number, number] => {
    const pieces = partitionCells(cells, lines);
    const worstArea = Math.max(0, ...pieces.map((piece) => {
      const fit = checkBedFit(piece.cells, printer);
      return fit.fits ? fit.binWidth * fit.binDepth : Number.POSITIVE_INFINITY;
    }));
    return [pieces.length, lines.length, worstArea];
  };
  return plans.sort((a, b) => {
    const sa = score(a), sb = score(b);
    return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2];
  })[0];
}

export interface PieceFitResult {
  pieces: number;
  allFit: boolean;
  worst: BedFitResult;
  failingPieces: BedFitResult[];
}

/** Bed fit across all pieces (every logical bin × its split chunks). */
export function checkPieceFit(
  bins: LogicalBin[], printer: PrinterProfile,
): PieceFitResult;
/** @deprecated Compatibility overload for callers migrating from global lines. */
export function checkPieceFit(
  cells: GridCell[], splitLines: SplitLine[], printer: PrinterProfile,
): PieceFitResult;
export function checkPieceFit(
  binsOrCells: LogicalBin[] | GridCell[],
  printerOrLines: PrinterProfile | SplitLine[],
  legacyPrinter?: PrinterProfile,
): PieceFitResult {
  const legacy = legacyPrinter !== undefined;
  const printer = legacy ? legacyPrinter : printerOrLines as PrinterProfile;
  const bins: LogicalBin[] = legacy
    ? [{ id: 0, cells: binsOrCells as GridCell[], isManual: true, splitLines: printerOrLines as SplitLine[] }]
    : binsOrCells as LogicalBin[];
  let worst: BedFitResult = { fits: true, binWidth: 0, binDepth: 0 };
  let allFit = true;
  let count = 0;
  const failingPieces: BedFitResult[] = [];
  for (const bin of bins) {
    for (const piece of partitionCells(bin.cells, bin.splitLines)) {
      count++;
      const fit = checkBedFit(piece.cells, printer);
      if (!fit.fits) {
        allFit = false;
        failingPieces.push(fit);
      }
      if ((!fit.fits && worst.fits) ||
          (fit.fits === worst.fits && fit.binWidth * fit.binDepth >= worst.binWidth * worst.binDepth)) {
        worst = fit;
      }
    }
  }
  return { pieces: count, allFit, worst, failingPieces };
}

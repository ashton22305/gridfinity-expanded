import type { GridCell, LogicalBin, PrinterProfile, BedFitResult, SplitLine } from './types';
import { GRID_PITCH } from './geometry/gridfinity';
import { partitionCells, sortSplitLines } from './split';
import type { DisplayCell } from './split';

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

/** Groups bin-tagged cells by their `bin` id; untagged cells form a single group 0. */
function groupByBin(cells: (GridCell | DisplayCell)[]): { bin: number; cells: GridCell[] }[] {
  const map = new Map<number, GridCell[]>();
  for (const c of cells) {
    const bin = 'bin' in c ? c.bin : 0;
    const group = map.get(bin);
    if (group) group.push(c); else map.set(bin, [c]);
  }
  return [...map.entries()]
    .map(([bin, groupCells]) => ({ bin, cells: groupCells }))
    .sort((a, b) => a.bin - b.bin);
}

function boxFits(widthCells: number, depthCells: number, printer: PrinterProfile): boolean {
  const binWidth = widthCells * GRID_PITCH;
  const binDepth = depthCells * GRID_PITCH;
  const normal = binWidth + BED_MARGIN * 2 <= printer.bedWidth &&
    binDepth + BED_MARGIN * 2 <= printer.bedDepth;
  const rotated = binDepth + BED_MARGIN * 2 <= printer.bedWidth &&
    binWidth + BED_MARGIN * 2 <= printer.bedDepth;
  return normal || rotated;
}

function checkBedFitOne(cells: GridCell[], printer: PrinterProfile): BedFitResult {
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

/**
 * Bed fit for a footprint. Accepts plain cells (single implicit bin) or
 * `DisplayCell`s tagged with a logical bin id, in which case each bin's
 * footprint is checked independently — bins are separate solids and never
 * need to share bed space. On multi-bin input the first non-fitting bin's
 * result is returned tagged with its `bin` id; otherwise the largest-area
 * (worst-case) bin's result is returned, also tagged.
 */
export function checkBedFit(
  cells: (GridCell | DisplayCell)[],
  printer: PrinterProfile
): BedFitResult {
  const groups = groupByBin(cells);
  if (groups.length <= 1) return checkBedFitOne(cells as GridCell[], printer);

  let worst: BedFitResult | null = null;
  for (const { bin, cells: groupCells } of groups) {
    const fit = checkBedFitOne(groupCells, printer);
    if (!fit.fits) return { ...fit, bin };
    if (!worst || fit.binWidth * fit.binDepth > worst.binWidth * worst.binDepth) {
      worst = { ...fit, bin };
    }
  }
  return worst as BedFitResult;
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
function computeAutoSplitLinesForBin(
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

/**
 * Every grid-line index on `axis` at which a single split of `cells`
 * (bounding box only) still leaves both resulting pieces fitting the bed.
 * Used to find an index one bin's split line can share with another's.
 */
function validShareIndices(cells: GridCell[], axis: 'x' | 'y', printer: PrinterProfile): number[] {
  const coords = cells.map((c) => (axis === 'x' ? c.x : c.y));
  const otherCoords = cells.map((c) => (axis === 'x' ? c.y : c.x));
  const min = Math.min(...coords), max = Math.max(...coords);
  const otherSpan = Math.max(...otherCoords) - Math.min(...otherCoords) + 1;
  const fits = (spanCells: number) => axis === 'x'
    ? boxFits(spanCells, otherSpan, printer)
    : boxFits(otherSpan, spanCells, printer);
  const indices: number[] = [];
  for (let index = min + 1; index <= max; index++) {
    if (fits(index - min) && fits(max + 1 - index)) indices.push(index);
  }
  return indices;
}

/**
 * Grid-line split positions that cut each logical bin into the fewest
 * evenly-sized pieces that each fit the printer bed. Plain cells are treated
 * as one implicit bin; `DisplayCell`s tagged with a `bin` id are split
 * independently per bin. When two or more bins each need exactly one split
 * on the same axis, and a single index would satisfy all of them, that index
 * is shared so the layout gets one cut line instead of several close
 * together — even if it is not the canonical (evenly-centered) position for
 * any individual bin.
 */
export function computeAutoSplitLines(
  cells: (GridCell | DisplayCell)[],
  printer: PrinterProfile,
): SplitLine[] {
  const groups = groupByBin(cells);
  if (groups.length <= 1) return computeAutoSplitLinesForBin(cells as GridCell[], printer);

  const perGroup = groups.map((g) => ({
    cells: g.cells,
    lines: computeAutoSplitLinesForBin(g.cells, printer),
  }));
  if (perGroup.every((g) => g.lines.length === 0)) return [];

  const merged: SplitLine[] = [];
  const handled = new Set<number>();
  for (const axis of ['x', 'y'] as const) {
    const candidates = perGroup
      .map((g, i) => ({ i, g }))
      .filter(({ i, g }) => !handled.has(i) && g.lines.length === 1 && g.lines[0].axis === axis);
    if (candidates.length < 2) continue;

    const ranges = candidates.map(({ g }) => new Set(validShareIndices(g.cells, axis, printer)));
    const shared = [...ranges[0]].filter((index) => ranges.every((r) => r.has(index)));
    if (shared.length === 0) continue;

    const index = shared[Math.floor((shared.length - 1) / 2)];
    merged.push({ axis, index });
    for (const { i } of candidates) handled.add(i);
  }

  const own = perGroup.flatMap((g, i) => (handled.has(i) ? [] : g.lines));
  return sortSplitLines([...merged, ...own]);
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
  cells: (GridCell | DisplayCell)[], splitLines: SplitLine[], printer: PrinterProfile,
): PieceFitResult;
export function checkPieceFit(
  binsOrCells: LogicalBin[] | (GridCell | DisplayCell)[],
  printerOrLines: PrinterProfile | SplitLine[],
  legacyPrinter?: PrinterProfile,
): PieceFitResult {
  const legacy = legacyPrinter !== undefined;
  const printer = legacy ? legacyPrinter : printerOrLines as PrinterProfile;
  const bins: LogicalBin[] = legacy
    ? groupByBin(binsOrCells as (GridCell | DisplayCell)[]).map(({ bin, cells: groupCells }) => ({
        id: bin, cells: groupCells, isManual: true, splitLines: printerOrLines as SplitLine[],
      }))
    : binsOrCells as LogicalBin[];
  let worst: BedFitResult = { fits: true, binWidth: 0, binDepth: 0 };
  let allFit = true;
  let count = 0;
  const failingPieces: BedFitResult[] = [];
  for (const bin of bins) {
    for (const piece of partitionCells(bin.cells, bin.splitLines)) {
      count++;
      const fit = { ...checkBedFit(piece.cells, printer), col: piece.col, row: piece.row };
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

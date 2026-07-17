import { addCutsUntilFit, partitionCells } from './cuts';
import { GRIDFINITY_SPEC, IMPLEMENTATION_ALLOWANCES } from './gridfinitySpec';
import type {
  BedFitResult,
  BinDesign,
  Cell,
  Cut,
  PrinterBuildVolumes,
  PrinterSettings,
} from './types';

const DEFAULT_HEAD_CLEARANCE = IMPLEMENTATION_ALLOWANCES.bedClearancePerSide;

function profile(
  name: string,
  bedWidth: number,
  bedDepth: number,
  buildHeight: number,
): PrinterSettings {
  return { name, bedWidth, bedDepth, buildHeight, headClearance: DEFAULT_HEAD_CLEARANCE };
}

export const PRINTER_PROFILES: PrinterSettings[] = [
  profile('Bambu Lab A1 Mini', 180, 180, 180),
  profile('Bambu Lab P1S / X1C', 256, 256, 256),
  profile('Creality Ender 3 / V2', 220, 220, 250),
  profile('Creality K1', 220, 220, 250),
  profile('Elegoo Centauri Carbon / Carbon 2', 256, 256, 256),
  profile('Prusa MK4 / MK3S+', 250, 210, 220),
  profile('Prusa Mini+', 180, 180, 180),
  profile('Voron 2.4 (250mm)', 250, 250, 250),
  profile('Voron 2.4 (300mm)', 300, 300, 300),
  profile('Custom', 220, 220, 250),
];

export function printerBuildVolumes(printer: PrinterSettings): PrinterBuildVolumes {
  return {
    full: {
      width: printer.bedWidth,
      depth: printer.bedDepth,
      height: printer.buildHeight,
    },
    safe: {
      width: Math.max(0, printer.bedWidth - printer.headClearance * 2),
      depth: Math.max(0, printer.bedDepth - printer.headClearance * 2),
      height: printer.buildHeight,
    },
  };
}

export function footprintCells(cells: Cell[]): { width: number; depth: number } {
  if (cells.length === 0) return { width: 0, depth: 0 };
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  return {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...ys) - Math.min(...ys) + 1,
  };
}

export function checkBedFit(
  cells: Cell[],
  printer: PrinterSettings,
  height = 0,
): BedFitResult {
  const footprint = footprintCells(cells);
  const width = footprint.width * GRIDFINITY_SPEC.gridPitch;
  const depth = footprint.depth * GRIDFINITY_SPEC.gridPitch;
  const safe = printerBuildVolumes(printer).safe;
  const normal = width <= safe.width && depth <= safe.depth;
  const rotated = depth <= safe.width && width <= safe.depth;
  const normalOverflow = Math.max(0, width - safe.width) + Math.max(0, depth - safe.depth);
  const rotatedOverflow = Math.max(0, depth - safe.width) + Math.max(0, width - safe.depth);
  const useRotation = !normal && (rotated || rotatedOverflow < normalOverflow);
  const orientedWidth = useRotation ? depth : width;
  const orientedDepth = useRotation ? width : depth;
  const fitsXy = normal || rotated;
  const fitsHeight = height <= safe.height;
  const failedAxes: BedFitResult['failedAxes'] = [];
  if (orientedWidth > safe.width) failedAxes.push('x');
  if (orientedDepth > safe.depth) failedAxes.push('y');
  if (!fitsHeight) failedAxes.push('z');
  return {
    fits: fitsXy && fitsHeight,
    fitsXy,
    fitsHeight,
    width,
    depth,
    height,
    rotated: useRotation,
    failedAxes,
  };
}

export function cutsForPrinter(cells: Cell[], printer: PrinterSettings, existing: Cut[] = []): Cut[] {
  return addCutsUntilFit(cells, existing, (part) => checkBedFit(part, printer).fitsXy);
}

export interface DesignFitResult {
  allFit: boolean;
  parts: number;
  worst: BedFitResult;
  failedAxes: Array<'x' | 'y' | 'z'>;
}

export function checkDesignFit(
  bins: BinDesign[],
  printer: PrinterSettings,
  height = 0,
): DesignFitResult {
  let worst = checkBedFit([], printer, height);
  let parts = 0;
  let allFit = true;
  const failedAxes = new Set<'x' | 'y' | 'z'>();
  for (const bin of bins) {
    for (const part of partitionCells(bin.cells, bin.cuts)) {
      parts++;
      const fit = checkBedFit(part.cells, printer, height);
      if (!fit.fits) allFit = false;
      fit.failedAxes.forEach((axis) => failedAxes.add(axis));
      const area = fit.width * fit.depth;
      const worstArea = worst.width * worst.depth;
      if ((!fit.fits && worst.fits) || fit.fits === worst.fits && area >= worstArea) worst = fit;
    }
  }
  return { allFit, parts, worst, failedAxes: [...failedAxes] };
}

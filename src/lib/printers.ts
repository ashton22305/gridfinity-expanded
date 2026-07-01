import type { GridCell, PrinterProfile, BedFitResult } from './types';
import { GRID_PITCH } from './geometry/gridfinity';

export const PRINTER_PROFILES: PrinterProfile[] = [
  { name: 'Bambu Lab A1 Mini', bedWidth: 180, bedDepth: 180 },
  { name: 'Bambu Lab P1S / X1C', bedWidth: 256, bedDepth: 256 },
  { name: 'Creality Ender 3 / V2', bedWidth: 220, bedDepth: 220 },
  { name: 'Creality K1', bedWidth: 220, bedDepth: 220 },
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

  return {
    fits:
      binWidth + BED_MARGIN * 2 <= printer.bedWidth &&
      binDepth + BED_MARGIN * 2 <= printer.bedDepth,
    binWidth,
    binDepth,
  };
}

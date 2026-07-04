import { create } from 'zustand';
import type { BinConfig, GridCell, PrinterProfile, SplitLine } from './lib/types';
import { PRINTER_PROFILES, computeAutoSplitLines } from './lib/printers';

const DEFAULT_PRINTER = PRINTER_PROFILES[5]; // Prusa MK4 / MK3S+

/** Editor grid bounds (cells). The minimum also grows to cover the painted shape. */
export const MAX_GRID = 40;

export function minGridSize(cells: GridCell[]): { cols: number; rows: number } {
  return {
    cols: Math.max(4, ...cells.map((c) => c.x + 1)),
    rows: Math.max(4, ...cells.map((c) => c.y + 1)),
  };
}

const DEFAULT_CONFIG: BinConfig = {
  cells: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  heightUnits: 3,
  wallThickness: 1.2,
  cavityCornerRadius: 2.5, // ≈ the interior look of the spec 3.75 mm outer corner minus one wall
  innerFilletRadius: 0.5,
  magnetHoles: true,
  screwHoles: false,
  openEdges: [],
  dividerEdges: [],
  innerWalls: [],
  splitMode: 'auto',
  splitLines: [],
  baseSlopes: [],
};

function sameSplitLines(a: SplitLine[], b: SplitLine[]): boolean {
  return a.length === b.length &&
    a.every((l, i) => l.axis === b[i].axis && l.index === b[i].index);
}

/**
 * In auto split mode, `splitLines` is always derived from the shape and the
 * printer bed. Applied on every config/printer write so the stored config is
 * always the effective one the geometry consumes. Returns the input config
 * unchanged when the lines are already current, so no-op writes keep the same
 * config identity and don't ripple into re-renders or geometry rebuilds.
 */
function withAutoSplit(config: BinConfig, printer: PrinterProfile): BinConfig {
  if (config.splitMode !== 'auto') return config;
  const lines = computeAutoSplitLines(config.cells, printer);
  if (sameSplitLines(lines, config.splitLines)) return config;
  return { ...config, splitLines: lines };
}

interface AppState {
  config: BinConfig;
  printer: PrinterProfile;
  /** Editor canvas size in cells — purely a UI concern, not part of the geometry config. */
  gridCols: number;
  gridRows: number;
  updateConfig: (patch: Partial<BinConfig>) => void;
  setPrinter: (printer: PrinterProfile) => void;
  setGridSize: (cols: number, rows: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  config: withAutoSplit(DEFAULT_CONFIG, DEFAULT_PRINTER),
  printer: DEFAULT_PRINTER,
  gridCols: 16,
  gridRows: 12,

  updateConfig: (patch) =>
    set((s) => ({ config: withAutoSplit({ ...s.config, ...patch }, s.printer) })),

  setPrinter: (printer) =>
    set((s) => ({ printer, config: withAutoSplit(s.config, printer) })),

  setGridSize: (cols, rows) =>
    set((s) => {
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return {};
      const min = minGridSize(s.config.cells);
      return {
        gridCols: Math.min(MAX_GRID, Math.max(min.cols, Math.round(cols))),
        gridRows: Math.min(MAX_GRID, Math.max(min.rows, Math.round(rows))),
      };
    }),
}));

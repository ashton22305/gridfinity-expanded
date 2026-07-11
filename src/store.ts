import { create } from 'zustand';
import type { BinConfig, GridCell, LogicalBin, PrinterProfile, SplitLine } from './lib/types';
import { PRINTER_PROFILES, computeAutoSplitLines } from './lib/printers';
import { flattenBins, sortSplitLines } from './lib/split';

const DEFAULT_PRINTER = PRINTER_PROFILES[5]; // Prusa MK4 / MK3S+

export const PANEL_MIN_WIDTH = 220;
export const PANEL_MAX_WIDTH = 900;

/**
 * The two resizable side panels: `sidebar` (left — the Shape/Walls/Split
 * editors) and `settings` (right — the Dimensions/Features/Printer forms).
 */
export type PanelSide = 'sidebar' | 'settings';

/**
 * Defaults leave the viewer ~2/3 of a 1080p-class window: the sidebar only
 * needs to host the cell editors now that the parameter forms live on the
 * right, and the settings forms read fine at roughly control width.
 */
const DEFAULT_PANEL_WIDTHS: Record<PanelSide, number> = {
  sidebar: 360,
  settings: 300,
};

/** Editor grid bounds (cells). The minimum also grows to cover the painted shape. */
export const MAX_GRID = 40;

export function minGridSize(cells: GridCell[]): { cols: number; rows: number } {
  return {
    cols: Math.max(4, ...cells.map((c) => c.x + 1)),
    rows: Math.max(4, ...cells.map((c) => c.y + 1)),
  };
}

const DEFAULT_CONFIG: BinConfig = {
  bins: [{
    id: 0,
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    isManual: false,
    splitLines: [],
  }],
  heightUnits: 3,
  wallThickness: 1.2,
  cavityCornerRadius: 2.5, // ≈ the interior look of the spec 3.75 mm outer corner minus one wall
  innerFilletRadius: 3.0,
  magnetHoles: false,
  screwHoles: false,
  openEdges: [],
  dividerEdges: [],
  innerWalls: [],
};

function sameSplitLines(a: SplitLine[], b: SplitLine[]): boolean {
  return a.length === b.length &&
    a.every((l, i) => l.axis === b[i].axis && l.index === b[i].index);
}

/** Keep one bin's effective lines current while preserving object identity on no-ops. */
function withEffectiveSplit(bin: LogicalBin, printer: PrinterProfile): LogicalBin {
  const lines = bin.isManual
    ? bin.splitLines.filter((line) => {
        const coords = bin.cells.map((cell) => line.axis === 'x' ? cell.x : cell.y);
        return coords.some((coord) => coord < line.index) && coords.some((coord) => coord >= line.index);
      })
    : computeAutoSplitLines(bin.cells, printer);
  return sameSplitLines(lines, bin.splitLines) ? bin : { ...bin, splitLines: lines };
}

/** Re-derive every bin after a printer change or whole-shape replacement. */
function withAutoSplit(config: BinConfig, printer: PrinterProfile): BinConfig {
  const bins = config.bins.map((bin) => withEffectiveSplit(bin, printer));
  const changed = bins.some((bin, i) => bin !== config.bins[i]);
  return changed ? { ...config, bins } : config;
}

interface AppState {
  config: BinConfig;
  printer: PrinterProfile;
  /** Editor canvas size in cells — purely a UI concern, not part of the geometry config. */
  gridCols: number;
  gridRows: number;
  /** Side panel widths in px — purely a UI concern, not part of the geometry config. */
  panelWidths: Record<PanelSide, number>;
  updateConfig: (patch: Partial<BinConfig>) => void;
  updateBin: (id: number, patch: Partial<LogicalBin>) => void;
  setPrinter: (printer: PrinterProfile) => void;
  setGridSize: (cols: number, rows: number) => void;
  setPanelWidth: (panel: PanelSide, width: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  config: withAutoSplit(DEFAULT_CONFIG, DEFAULT_PRINTER),
  printer: DEFAULT_PRINTER,
  gridCols: 7,
  gridRows: 7,
  panelWidths: DEFAULT_PANEL_WIDTHS,

  updateConfig: (patch) =>
    set((s) => {
      const config = { ...s.config, ...patch };
      return { config: patch.bins ? withAutoSplit(config, s.printer) : config };
    }),

  updateBin: (id, patch) =>
    set((s) => {
      const bins = s.config.bins.map((bin) => {
        if (bin.id !== id) return bin;
        const updated = {
          ...bin,
          ...patch,
          splitLines: patch.splitLines ? sortSplitLines(patch.splitLines) : bin.splitLines,
        };
        return withEffectiveSplit(updated, s.printer);
      });
      return { config: { ...s.config, bins } };
    }),

  setPrinter: (printer) =>
    set((s) => ({ printer, config: withAutoSplit(s.config, printer) })),

  setGridSize: (cols, rows) =>
    set((s) => {
      const min = minGridSize(flattenBins(s.config.bins));
      return {
        gridCols: Math.min(MAX_GRID, Math.max(min.cols, Math.round(cols))),
        gridRows: Math.min(MAX_GRID, Math.max(min.rows, Math.round(rows))),
      };
    }),

  setPanelWidth: (panel, width) =>
    set((s) => ({
      panelWidths: {
        ...s.panelWidths,
        [panel]: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width))),
      },
    })),
}));

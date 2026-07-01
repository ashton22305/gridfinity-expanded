export interface GridCell {
  x: number;
  y: number;
}

export type EdgeOrientation = 'h' | 'v';

/**
 * Canonical grid edge.
 * 'v' edge at (x, y): vertical segment on grid line x·PITCH spanning y·PITCH → (y+1)·PITCH;
 *                     separates cell (x-1, y) from cell (x, y).
 * 'h' edge at (x, y): horizontal segment on grid line y·PITCH spanning x·PITCH → (x+1)·PITCH;
 *                     separates cell (x, y-1) from cell (x, y).
 */
export interface GridEdge {
  x: number;
  y: number;
  orientation: EdgeOrientation;
}

/** Split at a grid line: 'x' → vertical line between columns index-1 and index. */
export interface SplitLine {
  axis: 'x' | 'y';
  index: number;
}

export interface BinConfig {
  cells: GridCell[];
  heightUnits: number;
  wallThickness: number;        // mm, slider 0.8–4.0
  cavityCornerRadius: number;   // cavity interior corner rounding in mm; outer wall is always spec
  innerFilletRadius: number;    // concave fillet radius at the cavity floor-to-wall junction in mm
  magnetHoles: boolean;         // 6.5mm × 2.4mm recesses in base for N52 disc magnets
  screwHoles: boolean;          // M3 pilot holes inside each magnet recess
  openEdges: GridEdge[];        // perimeter edges whose wall is REMOVED (exceptions to the default)
  dividerEdges: GridEdge[];     // internal edges with a divider wall ADDED (exceptions to the default)
  splitMode: 'auto' | 'manual'; // auto = UI derives splitLines from the printer bed
  splitLines: SplitLine[];      // always the effective value the geometry consumes
}

export interface PrinterProfile {
  name: string;
  bedWidth: number;
  bedDepth: number;
}

export interface BedFitResult {
  fits: boolean;
  binWidth: number;
  binDepth: number;
}

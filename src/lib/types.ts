export interface GridCell {
  x: number;
  y: number;
  bin?: number;  // logical bin id (default 0): adjacent cells with different ids
                 // become physically separate bins with their own outer walls
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

/**
 * Free-form inner wall: a straight segment in whole-bin mm coordinates, not
 * grid-aligned. Clipped to the bin interior; where it is lower than the outer
 * walls, a concave ramp blends its top into any taller structure it touches.
 */
export interface InnerWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;         // mm
  height: number | null; // mm above the cavity floor; null = full height
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
  innerWalls: InnerWall[];      // free-form (non-grid-aligned) walls inside the cavity
  splitMode: 'auto' | 'manual'; // auto = UI derives splitLines from the printer bed
  splitLines: SplitLine[];      // always the effective value the geometry consumes
  baseSlopes: BinSlope[];       // per-bin cavity floor tilt; bins without an entry are flat
}

export type SlopeDir = '+x' | '-x' | '+y' | '-y';  // side the floor is LOWEST at (shape-editor axes)

/** Cavity floor tilt for one logical bin; walls stay vertical, base stays spec. */
export interface BinSlope {
  bin: number;
  angle: number;   // degrees, 0 = flat
  dir: SlopeDir;
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

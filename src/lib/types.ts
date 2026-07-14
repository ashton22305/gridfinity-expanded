export interface Cell {
  x: number;
  y: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface GridPoint extends Point2 {}

export type EdgeOrientation = 'h' | 'v';

/**
 * Canonical unit grid edge in editor coordinates, where rows increase down.
 * A vertical edge at (x, y) runs from (x, y) to (x, y + 1); a horizontal
 * edge runs from (x, y) to (x + 1, y).
 */
export interface Edge {
  x: number;
  y: number;
  orientation: EdgeOrientation;
}

/** Straight, full-height wall in editor millimetres. */
export interface Wall {
  start: Point2;
  end: Point2;
  width: number;
}

/** Axis-aligned cut whose endpoints lie on exact grid points. */
export interface Cut {
  start: GridPoint;
  end: GridPoint;
}

export interface FastenerSettings {
  magnets: boolean;
  m3: boolean;
}

export interface PrinterSettings {
  name: string;
  bedWidth: number;
  bedDepth: number;
}

export interface BinDesign {
  id: string;
  cells: Cell[];
  openings: Edge[];
  walls: Wall[];
  cuts: Cut[];
}

/** Plain editor-owned input sent across the worker boundary. */
export interface Design {
  bins: BinDesign[];
  heightUnits: number;
  perimeterThickness: number;
  filletRadius: number;
  fasteners: FastenerSettings;
  printer: PrinterSettings;
}

/** Indexed triangles in final, part-local print coordinates. */
export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface GeneratedPart {
  id: string;
  binId: string;
  filename: string;
  mesh: TriangleMesh;
  /** Model-space placement that restores the design layout for preview. */
  layoutPosition: Point2;
  /** Preview-only transform; never applied to the printable mesh. */
  previewOffset: Point2;
}

export interface BedFitResult {
  fits: boolean;
  width: number;
  depth: number;
  rotated: boolean;
}

export interface GenerateGeometryRequest {
  requestId: number;
  design: Design;
}

export type GenerateGeometryResponse =
  | { ok: true; requestId: number; parts: GeneratedPart[] }
  | { ok: false; requestId: number; error: string };

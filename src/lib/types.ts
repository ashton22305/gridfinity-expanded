export interface GridCell {
  x: number;
  y: number;
}

export interface BinConfig {
  cells: GridCell[];
  heightUnits: number;
  wallThickness: number;
  cornerRadius: number;   // outer wall corner fillet radius in mm
  innerFilletRadius: number; // concave fillet radius at the cavity floor-to-wall junction in mm
  magnetHoles: boolean;   // 6.5mm × 2.4mm recesses in base for N52 disc magnets
  screwHoles: boolean;    // M3 pilot holes inside each magnet recess
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

import { primitives, booleans, expansions, extrusions, transforms, hulls } from '@jscad/modeling';
import type { BinConfig, GridCell } from '../types';

// ── Spec constants ─────────────────────────────────────────────────────────────
// All dimensions in mm. Reference: kennetek/gridfinity-rebuilt-openscad

export const GRID_PITCH        = 42;
export const HEIGHT_PER_UNIT   = 7;
export const BASE_TOTAL_HEIGHT = 7;   // connector peg (4.75 mm) + bridge (2.25 mm)

// Connector peg cross-section — three chamfered sections per spec:
//   z = 0      → PEG_Z1      45° lead-in chamfer  (PEG_W_BOTTOM → PEG_W_MID)
//   z = PEG_Z1 → PEG_Z2     vertical wall         (PEG_W_MID)
//   z = PEG_Z2 → PEG_HEIGHT  45° widening chamfer (PEG_W_MID → PEG_W_TOP)
const PEG_HEIGHT   = 4.75;
const PEG_Z1       = 0.8;
const PEG_Z2       = 2.6;
const PEG_W_BOTTOM = 35.6;
const PEG_W_MID    = 37.2;
const PEG_W_TOP    = 41.5;  // = GRID_PITCH - 0.5 mm clearance
const PEG_R_BOTTOM = 0.8;
const PEG_R_MID    = 1.5;   // softened from spec's 0.8 mm
const PEG_R_TOP    = 3.75;

const FLOOR_THICKNESS = 1.2;

// Floor fillet: concave quarter-circle at the cavity floor-to-wall junction.
// Uses stacked extrude prisms rather than hull() — hull fills concave notches
// on non-rectangular (L, T, staircase) bins, which punches a hole on subtract.
const FILLET_R     = 0.5;
const FILLET_STEPS = 12;

const MAGNET_RADIUS  = 3.25;   // 6.5 mm OD N52 disc magnets
const MAGNET_DEPTH   = 2.4;    // 2 mm + 0.4 mm tolerance
const SCREW_RADIUS   = 1.5;    // M3
const SCREW_DEPTH    = 6.0;
const FASTENER_INSET = 13.0;   // ±mm from cell centre to pocket centre

const CSG_EPSILON = 0.01;      // overlap to prevent coplanar faces in boolean ops

// ── JSCAD type aliases ─────────────────────────────────────────────────────────
// expansions.offset() returns the Geometry union type, which breaks JSCAD's
// overloaded extrudeLinear / hull signatures. Concrete aliases fix inference.
type Geom2 = ReturnType<typeof primitives.rectangle>;
type Geom3 = ReturnType<typeof primitives.cuboid>;

const FASTENER_OFFSETS: [number, number][] = [
  [-FASTENER_INSET, -FASTENER_INSET], [-FASTENER_INSET, FASTENER_INSET],
  [ FASTENER_INSET, -FASTENER_INSET], [ FASTENER_INSET, FASTENER_INSET],
];

// ── 2D / 3D primitives ─────────────────────────────────────────────────────────

/** Unions an array of geometries, including the single-item case JSCAD doesn't handle. */
function union<T>(items: T[]): T {
  if (items.length === 1) return items[0];
  return booleans.union(...(items as any[])) as T;
}

/** Rounded square centred at (cx, cy). */
function roundedRect(cx: number, cy: number, w: number, h: number, r: number): Geom2 {
  if (r <= 0) return primitives.rectangle({ size: [w, h], center: [cx, cy] }) as Geom2;
  return expansions.offset(
    { delta: r, corners: 'round', segments: 32 },
    primitives.rectangle({ size: [w - 2 * r, h - 2 * r], center: [cx, cy] }),
  ) as Geom2;
}

/** Thin disc extrusion used as a loft anchor in hull(). */
function disc(z: number, profile: Geom2): Geom3 {
  return transforms.translate([0, 0, z],
    extrusions.extrudeLinear({ height: CSG_EPSILON }, profile)) as Geom3;
}

// ── Geometry builders ──────────────────────────────────────────────────────────

/** Per-cell Gridfinity connector peg (z = 0 → PEG_HEIGHT). */
function buildPeg(cx: number, cy: number): Geom3 {
  const bottom = roundedRect(cx, cy, PEG_W_BOTTOM, PEG_W_BOTTOM, PEG_R_BOTTOM);
  const mid    = roundedRect(cx, cy, PEG_W_MID,    PEG_W_MID,    PEG_R_MID);
  const top    = roundedRect(cx, cy, PEG_W_TOP,    PEG_W_TOP,    PEG_R_TOP);

  return booleans.union(
    hulls.hull(disc(0,      bottom), disc(PEG_Z1,     mid)),  // bottom chamfer
    transforms.translate([0, 0, PEG_Z1],
      extrusions.extrudeLinear({ height: PEG_Z2 - PEG_Z1 }, mid)) as Geom3,  // vertical wall
    hulls.hull(disc(PEG_Z2, mid),    disc(PEG_HEIGHT, top)),  // upper chamfer
  ) as Geom3;
}

/** 2D outer wall profile derived from the cell footprint. */
function buildOuterProfile(cells: GridCell[], cornerRadius: number): Geom2 {
  const halfTol = (GRID_PITCH - PEG_W_TOP) / 2;  // 0.25 mm clearance per side

  const footprint = union(cells.map(({ x, y }) =>
    primitives.rectangle({
      size:   [GRID_PITCH, GRID_PITCH],
      center: [x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2],
    }) as Geom2
  ));

  if (cornerRadius <= 0) {
    return expansions.offset({ delta: -halfTol, corners: 'chamfer' }, footprint) as Geom2;
  }
  // Shrink by (halfTol + cornerRadius) then re-expand to apply the rounded fillet.
  return expansions.offset(
    { delta: cornerRadius, corners: 'round', segments: 32 },
    expansions.offset({ delta: -(halfTol + cornerRadius), corners: 'chamfer' }, footprint),
  ) as Geom2;
}

/** Connector pegs for all cells unified with the solid bridge and bin walls. */
function buildShell(cells: GridCell[], totalHeight: number, outerProfile: Geom2): Geom3 {
  const pegs: Geom3 = union(cells.map(({ x, y }) =>
    buildPeg(x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2)
  ));
  const body: Geom3 = transforms.translate([0, 0, PEG_HEIGHT],
    extrusions.extrudeLinear({ height: totalHeight - PEG_HEIGHT }, outerProfile)) as Geom3;

  return booleans.union(pegs, body) as Geom3;
}

/** Inner cavity volume with a concave quarter-circle fillet at the floor edge. */
function buildCavity(outerProfile: Geom2, totalHeight: number, wallThickness: number): Geom3 {
  const innerProfile: Geom2 = expansions.offset(
    { delta: -wallThickness, corners: 'round', segments: 16 },
    outerProfile,
  ) as Geom2;

  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;

  // Inset formula: R·(1 − √(2t − t²)), t = dz/R — traces a concave quarter-circle arc.
  const stepH = FILLET_R / FILLET_STEPS;
  const filletPrisms: Geom3[] = Array.from({ length: FILLET_STEPS }, (_, i) => {
    const t     = (i + 0.5) / FILLET_STEPS;
    const inset = FILLET_R * (1 - Math.sqrt(Math.max(0, 2 * t - t * t)));
    const prof: Geom2 = (inset > 0.001
      ? expansions.offset({ delta: -inset, corners: 'round', segments: 16 }, innerProfile)
      : innerProfile) as Geom2;
    return transforms.translate([0, 0, floorZ + i * stepH],
      extrusions.extrudeLinear({ height: stepH }, prof)) as Geom3;
  });

  const fillet: Geom3 = union(filletPrisms);
  const main:   Geom3 = transforms.translate([0, 0, floorZ + FILLET_R],
    extrusions.extrudeLinear(
      { height: totalHeight - floorZ - FILLET_R + CSG_EPSILON },
      innerProfile,
    )) as Geom3;

  return booleans.union(fillet, main) as Geom3;
}

/** Fastener pockets at the four corners of each cell's connector peg. */
function buildFastenerHoles(
  cells: GridCell[], radius: number, depth: number, segments: number,
): Geom3[] {
  return cells.flatMap(({ x, y }) => {
    const cx = x * GRID_PITCH + GRID_PITCH / 2;
    const cy = y * GRID_PITCH + GRID_PITCH / 2;
    return FASTENER_OFFSETS.map(([dx, dy]) =>
      primitives.cylinder({
        radius, segments,
        height: depth + CSG_EPSILON,
        center: [cx + dx, cy + dy, depth / 2],
      }) as Geom3
    );
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function generateBin(config: BinConfig): Geom3 {
  const { cells, heightUnits, wallThickness, cornerRadius, magnetHoles, screwHoles } = config;

  if (cells.length === 0) return primitives.cuboid({ size: [1, 1, 1], center: [0, 0, 0.5] }) as Geom3;

  const totalHeight  = BASE_TOTAL_HEIGHT + HEIGHT_PER_UNIT * Math.max(1, heightUnits);
  const outerProfile = buildOuterProfile(cells, cornerRadius);
  const shell        = buildShell(cells, totalHeight, outerProfile);
  const cavity       = buildCavity(outerProfile, totalHeight, wallThickness);

  let bin: Geom3 = booleans.subtract(shell, cavity) as Geom3;
  if (magnetHoles) bin = booleans.subtract(bin, ...buildFastenerHoles(cells, MAGNET_RADIUS, MAGNET_DEPTH, 32)) as Geom3;
  if (screwHoles)  bin = booleans.subtract(bin, ...buildFastenerHoles(cells, SCREW_RADIUS,  SCREW_DEPTH,  16)) as Geom3;
  return bin;
}

import { primitives, booleans, expansions, extrusions, transforms, hulls } from '@jscad/modeling';
import type { ManifoldToplevel, Manifold } from 'manifold-3d';
import type { BinConfig, GridCell } from '../types';
import { geom3ToManifold, geom2ToCrossSection, manifoldMesh, type BinMesh } from './manifold';

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

/** Thin disc extrusion used as a loft anchor in hull(), sitting just above z. */
function disc(z: number, profile: Geom2): Geom3 {
  return transforms.translate([0, 0, z],
    extrusions.extrudeLinear({ height: CSG_EPSILON }, profile)) as Geom3;
}

/** Loft anchor whose TOP face lands exactly on z (sits just below it). */
function discTop(z: number, profile: Geom2): Geom3 {
  return disc(z - CSG_EPSILON, profile);
}

// ── Geometry builders ──────────────────────────────────────────────────────────

/**
 * Per-cell Gridfinity connector peg (z = 0 → PEG_HEIGHT), returned as its three
 * convex sections rather than a single union. Each section is individually a
 * valid closed solid — what the manifold engine requires of its inputs — and the
 * sections meet flush at z = PEG_Z1, PEG_Z2 and PEG_HEIGHT: each hull's upper
 * loft anchor is top-aligned to its junction plane so no section overshoots into
 * the next. Flush coincident faces let the robust boolean fuse them without the
 * sub-micron slivers an overlap would leave. (The JSCAD fallback just unions the
 * three; its output is non-manifold regardless.)
 */
function pegSections(cx: number, cy: number): Geom3[] {
  const bottom = roundedRect(cx, cy, PEG_W_BOTTOM, PEG_W_BOTTOM, PEG_R_BOTTOM);
  const mid    = roundedRect(cx, cy, PEG_W_MID,    PEG_W_MID,    PEG_R_MID);
  const top    = roundedRect(cx, cy, PEG_W_TOP,    PEG_W_TOP,    PEG_R_TOP);

  return [
    hulls.hull(disc(0, bottom), discTop(PEG_Z1, mid)) as Geom3,       // bottom chamfer → [0, PEG_Z1]
    transforms.translate([0, 0, PEG_Z1],
      extrusions.extrudeLinear({ height: PEG_Z2 - PEG_Z1 }, mid)) as Geom3,  // vertical wall → [PEG_Z1, PEG_Z2]
    hulls.hull(disc(PEG_Z2, mid), discTop(PEG_HEIGHT, top)) as Geom3, // upper chamfer → [PEG_Z2, PEG_HEIGHT]
  ];
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
  const pegs: Geom3 = union(cells.flatMap(({ x, y }) =>
    pegSections(x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2)
  ));
  // Start the body CSG_EPSILON below the peg tops so the two solids overlap in
  // volume. A flush z = PEG_HEIGHT junction is a coplanar kiss between mismatched
  // cross-sections (rounded peg top vs. the outer wall), which the boolean fails
  // to fuse and exports as non-manifold seams.
  const body: Geom3 = transforms.translate([0, 0, PEG_HEIGHT - CSG_EPSILON],
    extrusions.extrudeLinear({ height: totalHeight - PEG_HEIGHT + CSG_EPSILON }, outerProfile)) as Geom3;

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
    // Overlap into the next step (and, on the last step, into `main`) by
    // CSG_EPSILON so the union merges through a real volume. The residual
    // T-junctions between differing step cross-sections are cleaned up by the
    // sanitizer (makeManifold) in the export path.
    return transforms.translate([0, 0, floorZ + i * stepH],
      extrusions.extrudeLinear({ height: stepH + CSG_EPSILON }, prof)) as Geom3;
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

/**
 * Manifold-engine build path — the default. Produces a guaranteed watertight,
 * 2-manifold triangle mesh with no self-intersections, so slicers never report
 * "non-manifold edge" errors.
 *
 * JSCAD's mesh booleans leave T-junctions along every curved cut and its 2D
 * `offset()` self-intersects once the inward distance exceeds a corner radius
 * (e.g. a thick wall on a rounded bin). Both defects export as non-manifold
 * geometry. Here JSCAD is used only to author the individual solids (each a
 * valid closed primitive) and 2D profiles; the manifold engine performs every
 * boolean and every inward offset (via Clipper2, which cannot self-intersect).
 */
export function generateBinManifold(wasm: ManifoldToplevel, config: BinConfig): BinMesh {
  const { Manifold } = wasm;
  const { cells, heightUnits, wallThickness, cornerRadius, magnetHoles, screwHoles } = config;

  if (cells.length === 0) {
    return manifoldMesh(geom3ToManifold(wasm, primitives.cuboid({ size: [1, 1, 1], center: [0, 0, 0.5] }) as Geom3));
  }

  const totalHeight  = BASE_TOTAL_HEIGHT + HEIGHT_PER_UNIT * Math.max(1, heightUnits);
  const outerProfile = buildOuterProfile(cells, cornerRadius);
  const outerCS      = geom2ToCrossSection(wasm, outerProfile);

  // Positive solids: the connector pegs plus the extruded body/wall column.
  const solids: Manifold[] = cells.flatMap(({ x, y }) =>
    pegSections(x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2)
      .map((s) => geom3ToManifold(wasm, s)),
  );
  // Flush at z = PEG_HEIGHT: safe only because both sides land on the identical
  // coordinate — 4.75 is exactly representable, so the float32-quantized peg
  // vertices and this double-precision extrude sit on the same plane and the
  // boolean fuses the interface. Flush junctions whose z comes from differing
  // float expressions do NOT fuse (see the fillet stack below).
  solids.push(outerCS.extrude(totalHeight - PEG_HEIGHT).translate([0, 0, PEG_HEIGHT]));
  let bin = Manifold.union(solids);

  // Cavity: a stack of concave-fillet prisms (floorZ → floorZ+FILLET_R) capped by
  // the straight inner column, which pokes CSG_EPSILON past the rim so the top
  // cut opens cleanly. Clipper2 offsets stay valid at any wall thickness.
  const innerCS = outerCS.offset(-wallThickness, 'Miter', 2);
  const floorZ  = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const stepH   = FILLET_R / FILLET_STEPS;
  const cavity: Manifold[] = Array.from({ length: FILLET_STEPS }, (_, i) => {
    const t     = (i + 0.5) / FILLET_STEPS;
    const inset = FILLET_R * (1 - Math.sqrt(Math.max(0, 2 * t - t * t)));
    const cs    = inset > 0.001 ? innerCS.offset(-inset, 'Miter', 2) : innerCS;
    // Overshoot each prism by CSG_EPSILON into the step above. Flush stacking
    // is NOT exact here: the shared plane is floorZ + (i+1)·stepH on one side
    // but (floorZ + i·stepH) + stepH on the other, and for some i those doubles
    // differ by 1 ULP. Manifold keeps the sub-nanometre gap, splitting the
    // cavity into stacked slabs whose subtraction leaves zero-thickness sheets
    // of bin material across the cavity (viewport z-fighting, and the topmost
    // sheet masks the floor fillet). The overshoot is swallowed inside the
    // strictly wider step above (innerCS itself at the top, matching the main
    // column below its own CSG_EPSILON overshoot), so no junction depends on
    // bit-exact plane matching.
    return cs.extrude(stepH + CSG_EPSILON).translate([0, 0, floorZ + i * stepH]);
  });
  cavity.push(
    innerCS.extrude(totalHeight - floorZ - FILLET_R + CSG_EPSILON).translate([0, 0, floorZ + FILLET_R]),
  );
  bin = bin.subtract(Manifold.union(cavity));

  // Fastener pockets (magnet recess and/or M3 pilot), subtracted as one union.
  const holes: Manifold[] = [
    ...(magnetHoles ? buildFastenerHoles(cells, MAGNET_RADIUS, MAGNET_DEPTH, 32) : []),
    ...(screwHoles  ? buildFastenerHoles(cells, SCREW_RADIUS,  SCREW_DEPTH,  16) : []),
  ].map((h) => geom3ToManifold(wasm, h));
  if (holes.length) bin = bin.subtract(Manifold.union(holes));

  return manifoldMesh(bin);
}

import { primitives, booleans, expansions, extrusions, transforms, hulls, measurements } from '@jscad/modeling';
import type { ManifoldToplevel, Manifold, CrossSection } from 'manifold-3d';
import type { BinConfig, BinSlope, GridCell, InnerWall, SlopeDir } from '../types';
import { effectiveWalls, edgeInsideCell, cellSet, type EffectiveWalls } from '../edges';
import { partitionCells, groupBins } from '../split';
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

// Outer wall corner rounding is ALWAYS the spec value so the wall stays flush
// with the base peg top and the bin stacks/nests like a standard Gridfinity bin.
// User-facing corner rounding applies to the cavity interior only.
const OUTER_R = PEG_R_TOP;

export const FLOOR_THICKNESS = 1.2;

// Floor fillet: concave quarter-circle at the cavity floor-to-wall junction.
// Uses stacked extrude prisms rather than hull() — hull fills concave notches
// on non-rectangular (L, T, staircase) bins, which punches a hole on subtract.
// Radius comes from config (innerFilletRadius); resolution scales with it.
const FILLET_STEPS_PER_MM = 24;

function filletSteps(r: number): number {
  return Math.min(48, Math.max(4, Math.ceil(r * FILLET_STEPS_PER_MM)));
}

/** Clamp the configured fillet radius so it never exceeds the cavity depth. */
function clampFilletR(requested: number, totalHeight: number): number {
  const cavityDepth = totalHeight - (BASE_TOTAL_HEIGHT + FLOOR_THICKNESS);
  return Math.max(0, Math.min(requested || 0, cavityDepth));
}

const MAGNET_RADIUS  = 3.25;   // 6.5 mm OD N52 disc magnets
const MAGNET_DEPTH   = 2.4;    // 2 mm + 0.4 mm tolerance
const SCREW_RADIUS   = 1.5;    // M3
const SCREW_DEPTH    = 6.0;
const FASTENER_INSET = 13.0;   // ±mm from cell centre to pocket centre

const CSG_EPSILON = 0.01;      // overlap to prevent coplanar faces in boolean ops

const EXPLODE_GAP = 4;         // preview gap between split pieces, per split line

// Free-form inner walls: embedded into the floor for a solid union, with a
// concave quarter-round ramp (radius TRANSITION_R, clamped to the available
// headroom) wherever a lower wall meets taller structure.
const WALL_EMBED   = 0.5;
const TRANSITION_R = 4;

/** Footprint quad of an inner-wall segment, CCW, extended CSG_EPSILON past each
 *  endpoint so an end landing exactly on a cavity face overlaps into the wall
 *  band instead of kissing it flush. Returns null for degenerate segments. */
function innerWallQuad(w: InnerWall): [number, number][] | null {
  const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  if (len < 0.1) return null;
  const hw = Math.max(0.4, w.width) / 2;
  const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len;
  const nx = -uy, ny = ux;
  const x1 = w.x1 - ux * CSG_EPSILON, y1 = w.y1 - uy * CSG_EPSILON;
  const x2 = w.x2 + ux * CSG_EPSILON, y2 = w.y2 + uy * CSG_EPSILON;
  return [
    [x1 - nx * hw, y1 - ny * hw],
    [x2 - nx * hw, y2 - ny * hw],
    [x2 + nx * hw, y2 + ny * hw],
    [x1 + nx * hw, y1 + ny * hw],
  ];
}

/** Top z of an inner wall; lands exactly on totalHeight when full height. */
function innerWallTop(w: InnerWall, floorZ: number, totalHeight: number): number {
  const cavityDepth = totalHeight - floorZ;
  if (w.height == null || w.height >= cavityDepth) return totalHeight;
  return floorZ + Math.max(0.5, w.height);
}

/** Per-bin slope entry lookup (first match wins; absent = flat). */
function slopeForBin(config: BinConfig, binId: number): BinSlope | undefined {
  return (config.baseSlopes ?? []).find((s) => s.bin === binId);
}

/** Unit 2D ascent direction of the sloped base (floor rises AWAY from the low side). */
function slopeAscent(dir: SlopeDir): [number, number] {
  switch (dir) {
    case '+x': return [-1, 0];  // low at +x → rises toward -x
    case '-x': return [1, 0];
    case '+y': return [0, -1];
    default:   return [0, 1];   // '-y'
  }
}

/** mm bounding box of a cell set. */
function cellBounds(cells: GridCell[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  return {
    minX: Math.min(...xs) * GRID_PITCH,
    minY: Math.min(...ys) * GRID_PITCH,
    maxX: (Math.max(...xs) + 1) * GRID_PITCH,
    maxY: (Math.max(...ys) + 1) * GRID_PITCH,
  };
}

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

/** 2D outer wall profile derived from the cell footprint — always the spec shape. */
function buildOuterProfile(cells: GridCell[]): Geom2 {
  const halfTol = (GRID_PITCH - PEG_W_TOP) / 2;  // 0.25 mm clearance per side

  const footprint = union(cells.map(({ x, y }) =>
    primitives.rectangle({
      size:   [GRID_PITCH, GRID_PITCH],
      center: [x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2],
    }) as Geom2
  ));

  // Shrink by (halfTol + OUTER_R) then re-expand to apply the rounded fillet.
  return expansions.offset(
    { delta: OUTER_R, corners: 'round', segments: 32 },
    expansions.offset({ delta: -(halfTol + OUTER_R), corners: 'chamfer' }, footprint),
  ) as Geom2;
}

/** Pitch-aligned bounding box of a piece's cells, in mm (the split slab). */
function piecePitchBox(cells: GridCell[]): Rect {
  const b = cellBounds(cells);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/**
 * Outer profile for one piece of a possibly-split logical bin. A whole bin is
 * the spec profile of its own cells (`binOuterCS`, precomputed once per bin by
 * the caller). A split piece is that whole-BIN profile cut by the piece's pitch
 * box, so every seam face lands exactly on the split-line pitch plane —
 * square-cornered, without the 0.25 mm perimeter clearance — and glued pieces
 * butt flush into the unsplit bin. (A profile built from the piece's own cells
 * insets and corner-rounds seam faces like outer walls: assembled pieces sit
 * 0.5 mm apart, with the floor/fillet band standing proud of the rounded-back
 * wall ends.) Non-seam sides of the box lie on footprint pitch lines the spec
 * profile never reaches, so only seam faces are affected.
 */
function pieceProfileCS(
  wasm: ManifoldToplevel, cells: GridCell[], binCells: GridCell[], binOuterCS: CrossSection,
): CrossSection {
  if (cells.length === binCells.length) return binOuterCS;
  return binOuterCS.intersect(new wasm.CrossSection(rectPoly(piecePitchBox(cells))));
}

/** JSCAD-fallback twin of pieceProfileCS (degraded mode: keeps the piece-cell
 *  profile — 0.25 mm-inset seams — if the 2D intersect throws). */
function pieceProfileJscad(cells: GridCell[], binCells: GridCell[], binOuterProfile: Geom2): Geom2 {
  if (cells.length === binCells.length) return binOuterProfile;
  try {
    const cut = booleans.intersect(binOuterProfile, rectGeom2(piecePitchBox(cells))) as Geom2;
    if (geom2Area(cut) > 1e-6) return cut;
  } catch { /* degraded mode: accept the inset seam */ }
  return buildOuterProfile(cells);
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

// ── Cavity plan ────────────────────────────────────────────────────────────────
// The cavity cross-section is authored as plain axis-aligned rectangles so the
// manifold path and the JSCAD fallback share one wall-layout computation.

interface Rect { x: number; y: number; w: number; h: number }

interface CavityPlan {
  cellSquares: Rect[];     // full 42×42 per cell; overshoots the outer face by the
                           // 0.25 mm clearance, so open edges cut cleanly through it
  solidStrips: Rect[];     // wall strips, concave-corner patches, divider strips
  openExtensions: Rect[];  // outward rects past open edges: keep the cavity rounding
                           // and floor fillet from retreating at open/seam faces
}

/**
 * Wall layout → rectangles. `t = halfTol + wallThickness` is the strip depth
 * measured from the 42 mm pitch line (0.25 mm clearance + the wall itself), so
 * the cavity face lands exactly `wallThickness` inside the outer wall face.
 */
function planCavity(cells: GridCell[], walls: EffectiveWalls, wallThickness: number, extDepth: number): CavityPlan {
  const P = GRID_PITCH;
  const halfTol = (GRID_PITCH - PEG_W_TOP) / 2;
  const t = halfTol + wallThickness;
  const OUT = 1;  // harmless outward slop past the pitch line
  const set = cellSet(cells);

  const cellSquares: Rect[] = cells.map(({ x, y }) => ({ x: x * P, y: y * P, w: P, h: P }));

  const solidStrips: Rect[] = [];
  const openExtensions: Rect[] = [];

  for (const e of walls.walled) {
    const inside = edgeInsideCell(set, e)!;
    // Strips span exactly the edge length: an end extension would leave wall
    // stubs protruding across an adjacent open face.
    if (e.orientation === 'h') {
      const below = inside.y === e.y - 1;
      solidStrips.push({ x: e.x * P, y: e.y * P - (below ? t : OUT), w: P, h: t + OUT });
    } else {
      const left = inside.x === e.x - 1;
      solidStrips.push({ x: e.x * P - (left ? t : OUT), y: e.y * P, w: t + OUT, h: P });
    }
  }

  for (const e of walls.open) {
    const inside = edgeInsideCell(set, e)!;
    if (e.orientation === 'h') {
      const below = inside.y === e.y - 1;
      openExtensions.push({ x: e.x * P, y: e.y * P - (below ? 0 : extDepth), w: P, h: extDepth });
    } else {
      const left = inside.x === e.x - 1;
      openExtensions.push({ x: e.x * P - (left ? 0 : extDepth), y: e.y * P, w: extDepth, h: P });
    }
  }

  for (const e of walls.dividers) {
    if (e.orientation === 'h') {
      solidStrips.push({ x: e.x * P, y: e.y * P - wallThickness / 2, w: P, h: wallThickness });
    } else {
      solidStrips.push({ x: e.x * P - wallThickness / 2, y: e.y * P, w: wallThickness, h: P });
    }
  }

  // Concave-corner patches: where exactly one of a lattice point's four
  // quadrant cells is absent and BOTH perimeter edges bordering the absent cell
  // are walled, the two strips meet only at the lattice point, leaving a t×t
  // cavity finger reaching the concave corner. Patch the diagonally opposite
  // quadrant. If either edge is open, the wall correctly ends flush there.
  const walledKeys = new Set(walls.walled.map((e) => `${e.orientation}:${e.x},${e.y}`));
  const lattice = new Set<string>();
  for (const c of cells) {
    for (const [lx, ly] of [[c.x, c.y], [c.x + 1, c.y], [c.x, c.y + 1], [c.x + 1, c.y + 1]]) {
      const key = `${lx},${ly}`;
      if (lattice.has(key)) continue;
      lattice.add(key);
      const quads: [number, number][] = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
      const absent = quads.filter(([qx, qy]) => !set.has(`${lx + qx},${ly + qy}`));
      if (absent.length !== 1) continue;
      const [qx, qy] = absent[0];
      const vKey = `v:${lx},${ly + qy}`;
      const hKey = `h:${lx + qx},${ly}`;
      if (!walledKeys.has(vKey) || !walledKeys.has(hKey)) continue;
      solidStrips.push({
        x: lx * P + (qx === 0 ? -t : 0),
        y: ly * P + (qy === 0 ? -t : 0),
        w: t, h: t,
      });
    }
  }

  return { cellSquares, solidStrips, openExtensions };
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

/**
 * Resolves config walls for a piece against its logical bin's cell set,
 * dropping stale entries. Edges between different logical bins are perimeter
 * edges of each bin, so adjacent bins get full outer walls facing each other.
 */
function resolveWalls(pieceCells: GridCell[], binCells: GridCell[], config: BinConfig): EffectiveWalls {
  return effectiveWalls(pieceCells, binCells, config.openEdges ?? [], config.dividerEdges ?? []);
}

function totalHeightOf(config: BinConfig): number {
  return BASE_TOTAL_HEIGHT + HEIGHT_PER_UNIT * Math.max(1, config.heightUnits);
}

// ── Manifold build path ────────────────────────────────────────────────────────

function rectPoly(r: Rect): [number, number][][] {
  return [[[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]];
}

/** Largest opening radius ≤ rc that doesn't erode the cavity away entirely. */
function clampOpeningRadius(ext: CrossSection, rc: number): number {
  const collapses = (r: number) => ext.offset(-r, 'Round', 2, 8).isEmpty();
  if (!collapses(rc)) return rc;
  if (collapses(0.25)) return 0;
  let lo = 0.25, hi = rc;  // invariant: lo survives, hi collapses
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (collapses(mid)) hi = mid; else lo = mid;
  }
  return lo;
}

/**
 * Cavity solid (or null when the plan leaves no cavity, e.g. a wall thicker
 * than the cell): a stack of concave-fillet prisms (floorZ → floorZ+filletR)
 * capped by the straight column, which pokes CSG_EPSILON past the rim so the
 * top cut opens cleanly.
 *
 * Both the corner rounding (a morphological opening) and the fillet insets
 * operate on the cavity EXTENDED through its open faces, then intersect back
 * to the real cavity: otherwise they would retreat from open/seam faces too,
 * growing ribs and floor bumps right where split pieces are glued together.
 * The opening is anti-extensive and erosions nest as insets shrink, so the
 * intersection preserves both "never breach a wall" and the CLAUDE.md
 * containment invariant (every prism sits inside the step above it).
 */
function buildCavityManifold(
  wasm: ManifoldToplevel, plan: CavityPlan, rc: number, filletR: number, totalHeight: number,
): { solid: Manifold; cs: CrossSection } | null {
  const CS = wasm.CrossSection;

  let cavityRaw = CS.union(plan.cellSquares.map(rectPoly));
  if (plan.solidStrips.length) {
    cavityRaw = cavityRaw.subtract(CS.union(plan.solidStrips.map(rectPoly)));
  }
  if (cavityRaw.isEmpty()) return null;

  const ext = plan.openExtensions.length
    ? CS.union([cavityRaw, ...plan.openExtensions.map(rectPoly)])
    : cavityRaw;

  let opened = ext;
  let cavityCS = cavityRaw;
  const r = rc > 0 ? clampOpeningRadius(ext, rc) : 0;
  if (r > 0) {
    const rounded = ext.offset(-r, 'Round', 2, 32).offset(r, 'Round', 2, 32).simplify(1e-3);
    const roundedCavity = rounded.intersect(cavityRaw);
    if (!roundedCavity.isEmpty()) {
      opened = rounded;
      cavityCS = roundedCavity;
    }
  }

  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const steps = filletR > 0 ? filletSteps(filletR) : 0;
  const stepH = steps > 0 ? filletR / steps : 0;
  const solids: Manifold[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const inset = filletR * (1 - Math.sqrt(Math.max(0, 2 * t - t * t)));
    const cs = inset > 0.001
      ? opened.offset(-inset, 'Miter', 2).intersect(cavityCS)
      : cavityCS;
    // Skipping empty steps is safe: insets shrink monotonically with i, so
    // skips only ever drop the bottom of the stack (thin cavity regions get a
    // shallower fillet) and every surviving prism still overshoots CSG_EPSILON
    // into the strictly-larger step above.
    if (cs.isEmpty()) continue;
    solids.push(cs.extrude(stepH + CSG_EPSILON).translate([0, 0, floorZ + i * stepH]));
  }
  solids.push(
    cavityCS.extrude(totalHeight - floorZ - filletR + CSG_EPSILON).translate([0, 0, floorZ + filletR]),
  );
  return { solid: wasm.Manifold.union(solids), cs: cavityCS };
}

/**
 * Free-form inner walls, clipped to the bin interior (clipCS = the outer wall
 * profile, so an end that reaches a wall overlaps into it and fuses cleanly;
 * at open faces the wall ends flush with the cut plane).
 *
 * Where a wall is lower than the rim, a stack of slabs above its top traces a
 * concave quarter-round ramp into everything taller that it touches: the
 * "material" region (outer walls + grid dividers = clip − cavity, plus any
 * taller inner wall's footprint) is dilated by the arc inset at each slab
 * height and intersected with the wall's own footprint. Slabs shrink with
 * height, so each overshoots CSG_EPSILON DOWNWARD into the strictly-larger
 * slab (or main wall) below it, per the containment rule.
 */
function buildInnerWallsManifold(
  wasm: ManifoldToplevel, walls: InnerWall[], clipCS: CrossSection, cavityCS: CrossSection,
  totalHeight: number,
): Manifold[] {
  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const planned: { footprint: CrossSection; top: number }[] = [];
  for (const w of walls) {
    const quad = innerWallQuad(w);
    if (!quad) continue;
    const footprint = new wasm.CrossSection([quad]).intersect(clipCS);
    if (footprint.isEmpty()) continue;
    planned.push({ footprint, top: innerWallTop(w, floorZ, totalHeight) });
  }

  const solids: Manifold[] = [];
  const baseMaterial = clipCS.subtract(cavityCS);
  planned.forEach((w, i) => {
    const bottom = floorZ - WALL_EMBED;
    solids.push(w.footprint.extrude(w.top - bottom).translate([0, 0, bottom]));

    const headroom = totalHeight - w.top;
    if (headroom < 0.05) return;  // full height (or as good as): nothing to blend into
    const R = Math.min(TRANSITION_R, headroom);
    let material = baseMaterial;
    for (let j = 0; j < planned.length; j++) {
      if (j !== i && planned[j].top > w.top + 0.01) material = material.add(planned[j].footprint);
    }
    if (material.isEmpty()) return;

    const steps = Math.min(16, Math.max(4, Math.ceil(R * 6)));
    const stepH = R / steps;
    for (let s = 0; s < steps; s++) {
      const h = (s + 0.5) * stepH;
      // Concave quarter circle tangent to the wall top (h=0, d=R) and the
      // taller face (h=R, d=0): d(h) = R − √(2Rh − h²).
      const d = R - Math.sqrt(Math.max(0, 2 * R * h - h * h));
      if (d <= 0.005) continue;
      const cs = material.offset(d, 'Round', 2, 16).intersect(w.footprint);
      if (cs.isEmpty()) continue;
      const zBottom = w.top + s * stepH - CSG_EPSILON;
      const zTop = Math.min(w.top + (s + 1) * stepH, totalHeight);
      solids.push(cs.extrude(zTop - zBottom).translate([0, 0, zBottom]));
    }
  });
  return solids;
}

/**
 * Sloped-base wedge: the cavity cross-section (clipped back to the outer
 * profile so it can't poke through open faces) extruded and cut by the slope
 * plane via trimByPlane. The floor stays at floorZ along the low side and
 * rises across the LOGICAL BIN's bounding box, so split pieces of one bin
 * share the same plane and their seams line up. Walls and base stay vertical.
 */
function buildSlopedBaseManifold(
  slope: BinSlope | undefined, binCells: GridCell[],
  clipCS: CrossSection, cavityCS: CrossSection, totalHeight: number,
): Manifold | null {
  const angle = Math.min(60, Math.max(0, slope?.angle || 0));
  if (angle < 0.1) return null;
  const m = Math.tan((angle * Math.PI) / 180);
  const [ax, ay] = slopeAscent(slope!.dir);
  const b = cellBounds(binCells);
  const corners: [number, number][] = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
  const along = corners.map(([x, y]) => ax * x + ay * y);
  const minA = Math.min(...along);
  const span = Math.max(...along) - minA;

  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const hMax = Math.min(m * span, totalHeight - floorZ);
  if (hMax < 0.02) return null;

  // Expand the footprint 0.2 mm INTO the surrounding walls before clipping to
  // the outer profile: a wedge built from cavityCS directly would sit face-to-
  // face with the cavity walls (same cross-section, different boolean lineage),
  // and such flush junctions can miss by an ULP and leave zero-thickness
  // membranes. The overlap is swallowed inside the walls; the clip keeps the
  // wedge from poking through open faces.
  const wedgeCS = cavityCS.offset(0.2, 'Miter', 2).intersect(clipCS);
  if (wedgeCS.isEmpty()) return null;
  const prism = wedgeCS
    .extrude(hMax + WALL_EMBED)
    .translate([0, 0, floorZ - WALL_EMBED]);
  // Keep the part below the plane z = floorZ + m·(a·p − minA): with
  // N = (m·ax, m·ay, −1), that is dot(p, N̂) ≥ −c0/|N|, c0 = floorZ − m·minA.
  const c0 = floorZ - m * minA;
  const len = Math.hypot(m, 1);
  return prism.trimByPlane([(m * ax) / len, (m * ay) / len, -1 / len], -c0 / len);
}

/**
 * One piece as a manifold solid, in layout (mm) coordinates. `cells` is the
 * piece's cell set; `binCells` is the full cell set of the logical bin it
 * belongs to (drives seam detection and the sloped-base plane, which must be
 * shared across all pieces of one bin).
 */
function generatePieceManifold(
  wasm: ManifoldToplevel, config: BinConfig, cells: GridCell[], binCells: GridCell[],
  binOuterCS: CrossSection, walls: EffectiveWalls, slope: BinSlope | undefined,
): Manifold {
  const { Manifold } = wasm;
  const totalHeight = totalHeightOf(config);
  const filletR = clampFilletR(config.innerFilletRadius, totalHeight);
  const rc = Math.max(0, config.cavityCornerRadius || 0);

  // Positive solids: the connector pegs plus the extruded body/wall column.
  const outerCS = pieceProfileCS(wasm, cells, binCells, binOuterCS);
  const solids: Manifold[] = cells.flatMap(({ x, y }) =>
    pegSections(x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2)
      .map((s) => geom3ToManifold(wasm, s)),
  );
  // Flush at z = PEG_HEIGHT: safe only because both sides land on the identical
  // coordinate — 4.75 is exactly representable, so the float32-quantized peg
  // vertices and this double-precision extrude sit on the same plane and the
  // boolean fuses the interface. Flush junctions whose z comes from differing
  // float expressions do NOT fuse (see the fillet stack in buildCavityManifold).
  solids.push(outerCS.extrude(totalHeight - PEG_HEIGHT).translate([0, 0, PEG_HEIGHT]));
  let bin = Manifold.union(solids);

  const plan = planCavity(cells, walls, config.wallThickness, Math.max(rc, filletR) + 1);
  const cavity = buildCavityManifold(wasm, plan, rc, filletR, totalHeight);
  if (cavity) {
    bin = bin.subtract(cavity.solid);

    // Interior additions live inside the cavity: free-form inner walls and the
    // sloped-base wedge. All overlap into existing material (floor embed, wall
    // band clip), so the unions fuse through real volume.
    const additions: Manifold[] = buildInnerWallsManifold(
      wasm, config.innerWalls ?? [], outerCS, cavity.cs, totalHeight);
    const wedge = buildSlopedBaseManifold(slope, binCells, outerCS, cavity.cs, totalHeight);
    if (wedge) additions.push(wedge);
    if (additions.length) bin = Manifold.union([bin, ...additions]);
  }

  // Fastener pockets (magnet recess and/or M3 pilot), subtracted as one union.
  const holes: Manifold[] = [
    ...(config.magnetHoles ? buildFastenerHoles(cells, MAGNET_RADIUS, MAGNET_DEPTH, 32) : []),
    ...(config.screwHoles  ? buildFastenerHoles(cells, SCREW_RADIUS,  SCREW_DEPTH,  16) : []),
  ].map((h) => geom3ToManifold(wasm, h));
  if (holes.length) bin = bin.subtract(Manifold.union(holes));

  // 1 µm simplify: drops the exactly-collinear vertices boolean triangulation
  // can leave along flush junction lines (zero-area sliver triangles) without
  // moving any real surface — 10× finer than the CSG_EPSILON overlaps.
  return bin.simplify(1e-3);
}

// ── Mesh utilities ─────────────────────────────────────────────────────────────

function translateMesh(mesh: BinMesh, dx: number, dy: number): BinMesh {
  if (dx === 0 && dy === 0) return mesh;
  const vp = new Float32Array(mesh.vertProperties);
  for (let i = 0; i < vp.length; i += 3) {
    vp[i] += dx;
    vp[i + 1] += dy;
  }
  return { vertProperties: vp, triVerts: mesh.triVerts };
}

/**
 * Mirrors a mesh across the XZ plane (y → offset − y), reversing triangle
 * winding so normals stay outward. The editors map SVG y (downward) straight to
 * mm +y while solids extrude up in +Z, so an unmirrored part viewed from above
 * is the chiral mirror of the drawn layout; every output mesh is mirrored here
 * so canvas, preview, and printed part all agree.
 */
function mirrorMeshY(mesh: BinMesh, offset: number): BinMesh {
  const vp = new Float32Array(mesh.vertProperties);
  for (let i = 1; i < vp.length; i += 3) vp[i] = offset - vp[i];
  const tv = new Uint32Array(mesh.triVerts.length);
  for (let i = 0; i < tv.length; i += 3) {
    tv[i] = mesh.triVerts[i];
    tv[i + 1] = mesh.triVerts[i + 2];
    tv[i + 2] = mesh.triVerts[i + 1];
  }
  return { vertProperties: vp, triVerts: tv };
}

function concatMeshes(meshes: BinMesh[]): BinMesh {
  if (meshes.length === 1) return meshes[0];
  const vertTotal = meshes.reduce((n, m) => n + m.vertProperties.length, 0);
  const triTotal = meshes.reduce((n, m) => n + m.triVerts.length, 0);
  const vertProperties = new Float32Array(vertTotal);
  const triVerts = new Uint32Array(triTotal);
  let vOff = 0, tOff = 0;
  for (const m of meshes) {
    vertProperties.set(m.vertProperties, vOff * 3);
    for (let i = 0; i < m.triVerts.length; i++) triVerts[tOff + i] = m.triVerts[i] + vOff;
    vOff += m.vertProperties.length / 3;
    tOff += m.triVerts.length;
  }
  return { vertProperties, triVerts };
}

function pieceName(binIdx: number, binCount: number, i: number, n: number): string {
  const stem = binCount === 1 ? 'gridfinity-bin' : `gridfinity-bin-${binIdx + 1}`;
  return n === 1 ? `${stem}.stl` : `${stem}-piece-${i + 1}-of-${n}.stl`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Manifold-engine build path — the default. Produces a guaranteed watertight,
 * 2-manifold triangle mesh with no self-intersections, so slicers never report
 * "non-manifold edge" errors.
 *
 * JSCAD's mesh booleans leave T-junctions along every curved cut and its 2D
 * `offset()` self-intersects once the inward distance exceeds a corner radius.
 * Both defects export as non-manifold geometry. Here JSCAD is used only to
 * author the individual solids (each a valid closed primitive) and 2D profiles;
 * the manifold engine performs every boolean and every inward offset (via
 * Clipper2, which cannot self-intersect).
 *
 * Ignores split lines — every logical bin as one solid, unioned into a single
 * mesh. Use generateBinPieces for the split-aware path.
 */
export function generateBinManifold(wasm: ManifoldToplevel, config: BinConfig): BinMesh {
  if (config.cells.length === 0) {
    return manifoldMesh(geom3ToManifold(wasm, primitives.cuboid({ size: [1, 1, 1], center: [0, 0, 0.5] }) as Geom3));
  }
  const solids = groupBins(config.cells).map((bin) => {
    const binOuterCS = geom2ToCrossSection(wasm, buildOuterProfile(bin.cells));
    return generatePieceManifold(wasm, config, bin.cells, bin.cells, binOuterCS,
      resolveWalls(bin.cells, bin.cells, config), slopeForBin(config, bin.id));
  });
  return manifoldMesh(solids.length === 1 ? solids[0] : wasm.Manifold.union(solids));
}

export interface BinPiece {
  name: string;
  col: number;
  row: number;
  mesh: BinMesh;   // piece-local coordinates (bbox min at the origin), print-ready
}

export interface BinPreview {
  bin: number;     // logical bin id, so the viewer can color-match the editors
  mesh: BinMesh;   // whole-layout coordinates, exploded, mirrored to match the canvas
}

/**
 * Split-aware build: partitions each logical bin's cells by config.splitLines
 * and generates every piece as an independent watertight solid. Seam faces
 * are open (walled only where the user placed a divider on the split line) so
 * glued pieces form one continuous bin; edges between DIFFERENT logical bins
 * are ordinary perimeter walls. Every piece keeps its own base pegs.
 *
 * The previews show the pieces in layout coordinates, exploded by EXPLODE_GAP
 * per split-grid position so seams are visible (adjacent logical bins stay in
 * place — they are already separate solids), one concatenated mesh per logical
 * bin so the viewer can color-match the editors.
 *
 * Every output mesh (pieces and previews) is mirrored via mirrorMeshY so the
 * part matches the canvas drawing instead of its chiral mirror.
 */
export function generateBinPieces(
  wasm: ManifoldToplevel, config: BinConfig,
): { pieces: BinPiece[]; previews: BinPreview[] } {
  if (config.cells.length === 0) {
    const mesh = generateBinManifold(wasm, config);
    return { pieces: [{ name: pieceName(0, 1, 0, 1), col: 0, row: 0, mesh }], previews: [{ bin: 0, mesh }] };
  }

  const layoutH = (Math.max(...config.cells.map((c) => c.y)) + 1) * GRID_PITCH;
  const bins = groupBins(config.cells);
  const pieces: BinPiece[] = [];
  const previews: BinPreview[] = [];
  const partsByBin = bins.map((bin) => partitionCells(bin.cells, config.splitLines ?? []));
  const anySplit = partsByBin.some((parts) => parts.length > 1);
  bins.forEach((bin, bi) => {
    const parts = partsByBin[bi];
    // Whole-bin spec profile, built once and shared by every piece of this bin.
    const binOuterCS = geom2ToCrossSection(wasm, buildOuterProfile(bin.cells));
    const binPreviewMeshes: BinMesh[] = [];
    parts.forEach((part, i) => {
      const solid = generatePieceManifold(
        wasm, config, part.cells, bin.cells, binOuterCS,
        resolveWalls(part.cells, bin.cells, config), slopeForBin(config, bin.id));
      const mesh = manifoldMesh(solid);
      const minX = Math.min(...part.cells.map((c) => c.x));
      const minY = Math.min(...part.cells.map((c) => c.y));
      const maxY = Math.max(...part.cells.map((c) => c.y));
      pieces.push({
        name: pieceName(bi, bins.length, i, parts.length),
        col: part.col,
        row: part.row,
        mesh: mirrorMeshY(
          translateMesh(mesh, -minX * GRID_PITCH, -minY * GRID_PITCH),
          (maxY - minY + 1) * GRID_PITCH),
      });
      binPreviewMeshes.push(mirrorMeshY(anySplit
        ? translateMesh(mesh, part.col * EXPLODE_GAP, part.row * EXPLODE_GAP)
        : mesh, layoutH));
    });
    previews.push({ bin: bin.id, mesh: concatMeshes(binPreviewMeshes) });
  });

  return { pieces, previews };
}

// ── JSCAD fallback path ────────────────────────────────────────────────────────
// Lower fidelity (non-manifold seams are expected of JSCAD mesh booleans, and
// large cavity rounding is skipped — JSCAD offset self-intersects on big inward
// deltas), but it must never throw: it is the degraded mode when WASM fails.

function rectGeom2(r: Rect): Geom2 {
  return primitives.rectangle({ size: [r.w, r.h], center: [r.x + r.w / 2, r.y + r.h / 2] }) as Geom2;
}

function geom2Area(g: Geom2): number {
  try {
    return Math.abs(measurements.measureArea(g) as number);
  } catch {
    return 0;
  }
}

function buildCavityJscad(
  plan: CavityPlan, rc: number, filletR: number, totalHeight: number,
): { geom: Geom3; cs: Geom2 } | null {
  let cavityRaw = union(plan.cellSquares.map(rectGeom2));
  if (plan.solidStrips.length) {
    cavityRaw = booleans.subtract(cavityRaw, union(plan.solidStrips.map(rectGeom2))) as Geom2;
  }
  if (geom2Area(cavityRaw) < 1e-6) return null;

  // Unlike the manifold path, the cavity is NOT extended through open faces
  // before rounding/fillet insets: JSCAD's 2D booleans choke on the exactly
  // abutting extension rects ("geometry is not closed"). The rounding and
  // fillet therefore retreat slightly at open faces — a cosmetic defect that is
  // acceptable in this degraded mode.
  let cavityCS = cavityRaw;
  if (rc > 0 && rc <= 6) {
    try {
      const rounded = expansions.offset({ delta: rc, corners: 'round', segments: 32 },
        expansions.offset({ delta: -rc, corners: 'round', segments: 32 }, cavityRaw)) as Geom2;
      if (geom2Area(rounded) > 1e-6) cavityCS = rounded;
    } catch { /* keep the unrounded cavity */ }
  }

  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const solids: Geom3[] = [];
  const steps = filletR > 0 ? filletSteps(filletR) : 0;
  const stepH = steps > 0 ? filletR / steps : 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const inset = filletR * (1 - Math.sqrt(Math.max(0, 2 * t - t * t)));
    try {
      const prof = (inset > 0.001
        ? expansions.offset({ delta: -inset, corners: 'round', segments: 16 }, cavityCS)
        : cavityCS) as Geom2;
      if (geom2Area(prof) < 1e-6) continue;
      // Overlap into the next step (and, on the last step, into the column) by
      // CSG_EPSILON so the union merges through a real volume.
      solids.push(transforms.translate([0, 0, floorZ + i * stepH],
        extrusions.extrudeLinear({ height: stepH + CSG_EPSILON }, prof)) as Geom3);
    } catch { continue; }
  }
  solids.push(transforms.translate([0, 0, floorZ + filletR],
    extrusions.extrudeLinear(
      { height: totalHeight - floorZ - filletR + CSG_EPSILON },
      cavityCS,
    )) as Geom3);
  return { geom: union(solids), cs: cavityCS };
}

/** Fallback inner walls: clipped prisms, no height-transition ramps (degraded mode). */
function buildInnerWallsJscad(walls: InnerWall[], outerProfile: Geom2, totalHeight: number): Geom3[] {
  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const solids: Geom3[] = [];
  for (const w of walls) {
    const quad = innerWallQuad(w);
    if (!quad) continue;
    let fp = primitives.polygon({ points: quad }) as Geom2;
    try {
      const clipped = booleans.intersect(fp, outerProfile) as Geom2;
      if (geom2Area(clipped) < 1e-6) continue;
      fp = clipped;
    } catch { /* unclipped quad still renders; may poke past walls in degraded mode */ }
    const top = innerWallTop(w, floorZ, totalHeight);
    const bottom = floorZ - WALL_EMBED;
    try {
      solids.push(transforms.translate([0, 0, bottom],
        extrusions.extrudeLinear({ height: top - bottom }, fp)) as Geom3);
    } catch { continue; }
  }
  return solids;
}

/** Fallback sloped base: a staircase of slabs under the slope plane (degraded mode). */
function buildSlopedBaseJscad(
  slope: BinSlope | undefined, binCells: GridCell[], cavityCS: Geom2, totalHeight: number,
): Geom3[] {
  const angle = Math.min(60, Math.max(0, slope?.angle || 0));
  if (angle < 0.1) return [];
  const m = Math.tan((angle * Math.PI) / 180);
  const [ax, ay] = slopeAscent(slope!.dir);
  const b = cellBounds(binCells);
  const corners: [number, number][] = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
  const along = corners.map(([x, y]) => ax * x + ay * y);
  const minA = Math.min(...along);
  const span = Math.max(...along) - minA;

  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const hMax = Math.min(m * span, totalHeight - floorZ);
  if (hMax < 0.02) return [];

  // Ascent is axis-aligned, so each "at least this tall" region is a plain rect.
  const halfRect = (s: number): Geom2 => {
    const pad = 1;
    if (ax === 1)  return rectGeom2({ x: b.minX + s, y: b.minY - pad, w: b.maxX - (b.minX + s) + pad, h: b.maxY - b.minY + 2 * pad });
    if (ax === -1) return rectGeom2({ x: b.minX - pad, y: b.minY - pad, w: (b.maxX - s) - b.minX + pad, h: b.maxY - b.minY + 2 * pad });
    if (ay === 1)  return rectGeom2({ x: b.minX - pad, y: b.minY + s, w: b.maxX - b.minX + 2 * pad, h: b.maxY - (b.minY + s) + pad });
    return rectGeom2({ x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: (b.maxY - s) - b.minY + pad });
  };

  const solids: Geom3[] = [];
  const steps = 12;
  const dh = hMax / steps;
  for (let k = 0; k < steps; k++) {
    const s = ((k + 1) * dh) / m;
    if (s >= span) break;
    try {
      const prof = booleans.intersect(cavityCS, halfRect(s)) as Geom2;
      if (geom2Area(prof) < 1e-6) continue;
      const bottom = k === 0 ? floorZ - WALL_EMBED : floorZ + k * dh - CSG_EPSILON;
      solids.push(transforms.translate([0, 0, bottom],
        extrusions.extrudeLinear({ height: floorZ + (k + 1) * dh - bottom }, prof)) as Geom3);
    } catch { continue; }
  }
  return solids;
}

function generatePieceJscad(
  config: BinConfig, cells: GridCell[], binCells: GridCell[], binOuterProfile: Geom2,
  walls: EffectiveWalls, slope: BinSlope | undefined,
): Geom3 {
  const totalHeight = totalHeightOf(config);
  const filletR = clampFilletR(config.innerFilletRadius, totalHeight);
  const rc = Math.max(0, config.cavityCornerRadius || 0);

  const outerProfile = pieceProfileJscad(cells, binCells, binOuterProfile);
  const shell = buildShell(cells, totalHeight, outerProfile);
  const plan = planCavity(cells, walls, config.wallThickness, Math.max(rc, filletR) + 1);
  const cavity = buildCavityJscad(plan, rc, filletR, totalHeight);

  let bin: Geom3 = cavity ? booleans.subtract(shell, cavity.geom) as Geom3 : shell;
  if (cavity) {
    const additions = [
      ...buildInnerWallsJscad(config.innerWalls ?? [], outerProfile, totalHeight),
      ...buildSlopedBaseJscad(slope, binCells, cavity.cs, totalHeight),
    ];
    if (additions.length) bin = booleans.union(bin, ...additions) as Geom3;
  }
  if (config.magnetHoles) bin = booleans.subtract(bin, ...buildFastenerHoles(cells, MAGNET_RADIUS, MAGNET_DEPTH, 32)) as Geom3;
  if (config.screwHoles)  bin = booleans.subtract(bin, ...buildFastenerHoles(cells, SCREW_RADIUS,  SCREW_DEPTH,  16)) as Geom3;
  return bin;
}

/** JSCAD-only fallback for the whole layout (ignores split lines). */
export function generateBin(config: BinConfig): Geom3 {
  if (config.cells.length === 0) return primitives.cuboid({ size: [1, 1, 1], center: [0, 0, 0.5] }) as Geom3;
  const solids = groupBins(config.cells).map((bin) =>
    generatePieceJscad(config, bin.cells, bin.cells, buildOuterProfile(bin.cells),
      resolveWalls(bin.cells, bin.cells, config), slopeForBin(config, bin.id)));
  return union(solids);
}

export interface BinPieceGeom {
  name: string;
  bin: number;         // logical bin id, so the viewer can color-match the editors
  exportGeom: Geom3;   // piece-local coordinates, print-ready
  previewGeom: Geom3;  // whole-bin coordinates, exploded
}

/**
 * JSCAD-only fallback for the split-aware path. Output geoms are mirrored
 * across Y (same rationale as mirrorMeshY) so the part matches the canvas.
 */
export function generateBinPiecesJscad(config: BinConfig): BinPieceGeom[] {
  if (config.cells.length === 0) {
    const geom = generateBin(config);
    return [{ name: pieceName(0, 1, 0, 1), bin: 0, exportGeom: geom, previewGeom: geom }];
  }
  const layoutH = (Math.max(...config.cells.map((c) => c.y)) + 1) * GRID_PITCH;
  const bins = groupBins(config.cells);
  const partsByBin = bins.map((bin) => partitionCells(bin.cells, config.splitLines ?? []));
  const anySplit = partsByBin.some((parts) => parts.length > 1);
  return bins.flatMap((bin, bi) => {
    const parts = partsByBin[bi];
    // Whole-bin spec profile, built once and shared by every piece of this bin.
    const binOuterProfile = buildOuterProfile(bin.cells);
    return parts.map((part, i) => {
      const geom = generatePieceJscad(config, part.cells, bin.cells, binOuterProfile,
        resolveWalls(part.cells, bin.cells, config), slopeForBin(config, bin.id));
      const minX = Math.min(...part.cells.map((c) => c.x));
      const minY = Math.min(...part.cells.map((c) => c.y));
      const maxY = Math.max(...part.cells.map((c) => c.y));
      const local = transforms.translate([-minX * GRID_PITCH, -minY * GRID_PITCH, 0], geom) as Geom3;
      const placed = anySplit
        ? transforms.translate([part.col * EXPLODE_GAP, part.row * EXPLODE_GAP, 0], geom) as Geom3
        : geom;
      return {
        name: pieceName(bi, bins.length, i, parts.length),
        bin: bin.id,
        exportGeom: transforms.translate([0, (maxY - minY + 1) * GRID_PITCH, 0],
          transforms.mirrorY(local)) as Geom3,
        previewGeom: transforms.translate([0, layoutH, 0], transforms.mirrorY(placed)) as Geom3,
      };
    });
  });
}

import type { ManifoldToplevel, Manifold, CrossSection } from 'manifold-3d';
import type { BinConfig, BinSlope, GridCell, InnerWall, SlopeDir } from '../types';
import { effectiveWalls, edgeInsideCell, cellSet, type EffectiveWalls } from '../edges';
import { flattenBins, partitionCells } from '../split';
import { manifoldMesh, repairMesh, type BinMesh } from './manifold';

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
// Adjacent offset profiles are lofted into connected facets so every wall uses
// the same continuous round without the horizontal terraces of stacked slabs.
const FILLET_SEGMENTS = 32;

/** Build a continuous quarter-circle floor fillet from caller-supplied profiles. */
function buildFloorFillet(
  wasm: ManifoldToplevel, radius: number, floorZ: number,
  profileAt: (distance: number) => CrossSection, clipCS: CrossSection,
): Manifold | null {
  if (radius <= 0) return null;
  const steps = Math.min(48, Math.max(8, Math.ceil(radius * 8)));
  const segments: Manifold[] = [];
  for (let step = 0; step < steps; step++) {
    const h0 = radius * step / steps;
    const h1 = radius * (step + 1) / steps;
    const distanceAt = (height: number) =>
      radius - Math.sqrt(Math.max(0, 2 * radius * height - height * height));
    const lowerProfile = profileAt(distanceAt(h0));
    const upperProfile = profileAt(distanceAt(h1));
    if (lowerProfile.isEmpty() || upperProfile.isEmpty()) continue;
    const lower = lowerProfile.extrude(CSG_EPSILON)
      .translate([0, 0, floorZ + h0 - CSG_EPSILON / 2]);
    const upper = upperProfile.extrude(CSG_EPSILON)
      .translate([0, 0, floorZ + h1 - CSG_EPSILON / 2]);
    segments.push(wasm.Manifold.hull([lower, upper]));
  }
  if (!segments.length) return null;
  const clip = clipCS.extrude(radius + CSG_EPSILON)
    .translate([0, 0, floorZ - CSG_EPSILON / 2]);
  return wasm.Manifold.union(segments).intersect(clip);
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
const PREVIEW_INSET = 0.15;    // per side; adjacent split pieces show a 0.3 mm gap


// Free-form inner walls: embedded into the floor for a solid union, with the
// configured cavity fillet at their base and a concave quarter-round ramp
// (radius TRANSITION_R, clamped to the available headroom) wherever a lower
// wall meets taller structure.
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

const FASTENER_OFFSETS: [number, number][] = [
  [-FASTENER_INSET, -FASTENER_INSET], [-FASTENER_INSET, FASTENER_INSET],
  [ FASTENER_INSET, -FASTENER_INSET], [ FASTENER_INSET, FASTENER_INSET],
];

// ── 2D / 3D primitives ─────────────────────────────────────────────────────────

/** Rounded square centred at (cx, cy). */
function roundedRect(
  wasm: ManifoldToplevel, cx: number, cy: number, w: number, h: number, r: number,
): CrossSection {
  const core = wasm.CrossSection.square([w - 2 * r, h - 2 * r], true)
    .translate([cx, cy]);
  return r <= 0 ? core : core.offset(r, 'Round', 2, 32);
}

// ── Geometry builders ──────────────────────────────────────────────────────────

/**
 * Per-cell Gridfinity connector peg (z = 0 → PEG_HEIGHT), returned as its three
 * convex sections rather than a single union. Each section is individually a
 * valid closed solid — what the manifold engine requires of its inputs — and the
 * sections meet flush at z = PEG_Z1, PEG_Z2 and PEG_HEIGHT: each hull's upper
 * loft anchor is top-aligned to its junction plane so no section overshoots into
 * the next. Flush coincident faces let the robust boolean fuse them without the
 * sub-micron slivers an overlap would leave.
 */
function pegSections(wasm: ManifoldToplevel, cx: number, cy: number): Manifold[] {
  const bottom = roundedRect(wasm, cx, cy, PEG_W_BOTTOM, PEG_W_BOTTOM, PEG_R_BOTTOM);
  const mid    = roundedRect(wasm, cx, cy, PEG_W_MID,    PEG_W_MID,    PEG_R_MID);
  const top    = roundedRect(wasm, cx, cy, PEG_W_TOP,    PEG_W_TOP,    PEG_R_TOP);
  const loft = (a: CrossSection, z1: number, b: CrossSection, z2: number) =>
    wasm.Manifold.hull([
      a.extrude(CSG_EPSILON).translate([0, 0, z1]),
      b.extrude(CSG_EPSILON).translate([0, 0, z2 - CSG_EPSILON]),
    ]);

  return [
    loft(bottom, 0, mid, PEG_Z1),
    mid.extrude(PEG_Z2 - PEG_Z1).translate([0, 0, PEG_Z1]),
    loft(mid, PEG_Z2, top, PEG_HEIGHT),
  ];
}

/** 2D outer wall profile derived from the cell footprint — always the spec shape. */
function buildOuterProfile(wasm: ManifoldToplevel, cells: GridCell[]): CrossSection {
  const halfTol = (GRID_PITCH - PEG_W_TOP) / 2;  // 0.25 mm clearance per side
  const footprint = wasm.CrossSection.union(cells.map(({ x, y }) =>
    wasm.CrossSection.square([GRID_PITCH, GRID_PITCH]).translate([x * GRID_PITCH, y * GRID_PITCH])));

  // Shrink by (halfTol + OUTER_R) then re-expand to apply the rounded fillet.
  return footprint.offset(-(halfTol + OUTER_R), 'Square', 2)
    .offset(OUTER_R, 'Round', 2, 32);
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

// ── Cavity plan ────────────────────────────────────────────────────────────────
// The cavity cross-section is authored as plain axis-aligned rectangles.

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
 *
 * `binCells`/`wholeWalls` describe the LOGICAL BIN this piece belongs to (the
 * same values regardless of which piece is being planned): a concave corner's
 * two bordering walls can end up owned by two different split pieces, so
 * detecting the corner and deciding whether it's walled must look at the
 * whole bin, not just this piece's own cells/edges. Only the piece that
 * actually contains the patch's target cell adds it, so it's never built
 * twice, dropped, or attempted by a piece that doesn't have the material to
 * receive it.
 */
function planCavity(
  cells: GridCell[], binCells: GridCell[], walls: EffectiveWalls, wholeWalls: EffectiveWalls,
  wallThickness: number, extDepth: number,
): CavityPlan {
  const P = GRID_PITCH;
  const halfTol = (GRID_PITCH - PEG_W_TOP) / 2;
  const t = halfTol + wallThickness;
  const OUT = 1;  // harmless outward slop past the pitch line
  const set = cellSet(cells);
  const wholeSet = cellSet(binCells);

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
  // quadrant cells is absent from the WHOLE BIN and BOTH perimeter edges
  // bordering the absent cell are walled in the whole bin, the two strips
  // meet only at the lattice point, leaving a t×t cavity finger reaching the
  // concave corner. Patch the diagonally opposite quadrant — but only from
  // the piece that owns that quadrant's cell, since the two bordering edges
  // (and the patch itself) can each land in a different split piece.
  const wholeWalledKeys = new Set(wholeWalls.walled.map((e) => `${e.orientation}:${e.x},${e.y}`));
  const lattice = new Set<string>();
  for (const c of cells) {
    for (const [lx, ly] of [[c.x, c.y], [c.x + 1, c.y], [c.x, c.y + 1], [c.x + 1, c.y + 1]]) {
      const key = `${lx},${ly}`;
      if (lattice.has(key)) continue;
      lattice.add(key);
      const quads: [number, number][] = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
      const absent = quads.filter(([qx, qy]) => !wholeSet.has(`${lx + qx},${ly + qy}`));
      if (absent.length !== 1) continue;
      const [qx, qy] = absent[0];
      const vKey = `v:${lx},${ly + qy}`;
      const hKey = `h:${lx + qx},${ly}`;
      if (!wholeWalledKeys.has(vKey) || !wholeWalledKeys.has(hKey)) continue;
      const patchCellX = lx + (qx === 0 ? -1 : 0);
      const patchCellY = ly + (qy === 0 ? -1 : 0);
      if (!set.has(`${patchCellX},${patchCellY}`)) continue;  // another piece owns this patch
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
  wasm: ManifoldToplevel, cells: GridCell[], radius: number, depth: number, segments: number,
): Manifold[] {
  return cells.flatMap(({ x, y }) => {
    const cx = x * GRID_PITCH + GRID_PITCH / 2;
    const cy = y * GRID_PITCH + GRID_PITCH / 2;
    return FASTENER_OFFSETS.map(([dx, dy]) => wasm.Manifold
      .cylinder(depth + CSG_EPSILON, radius, radius, segments)
      .translate([cx + dx, cy + dy, 0]));
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
 * than the cell): a connected profile loft forms the continuous concave floor fillet
 * (floorZ → floorZ+filletR), capped by the straight column, which pokes
 * CSG_EPSILON past the rim so the top cut opens cleanly.
 *
 * Both the corner rounding (a morphological opening) and the fillet insets
 * operate on the cavity EXTENDED through its open faces, then intersect back
 * to the real cavity: otherwise they would retreat from open/seam faces too,
 * growing ribs and floor bumps right where split pieces are glued together.
 * The final intersection preserves the "never breach a wall" invariant. The
 * loft uses the same quarter-circle builder as free-form inner walls, so all
 * floor-to-wall junctions have matching connected facets.
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
  const solids: Manifold[] = [];
  if (filletR > 0) {
    const fillet = buildFloorFillet(
      wasm, filletR, floorZ,
      (distance) => distance > 0.001
        ? opened.offset(-distance, 'Miter', 2).intersect(cavityCS)
        : cavityCS,
      cavityCS,
    );
    if (fillet) solids.push(fillet);
  }
  solids.push(cavityCS
    .extrude(totalHeight - floorZ - filletR + CSG_EPSILON)
    .translate([0, 0, floorZ + filletR]));
  return { solid: wasm.Manifold.union(solids), cs: cavityCS };
}

/**
 * Free-form inner walls, clipped to the bin interior (clipCS = the outer wall
 * profile, so an end that reaches a wall overlaps into it and fuses cleanly;
 * at open faces the wall ends flush with the cut plane).
 *
 * Connected loft segments around each wall footprint add the configured cavity
 * fillet at the floor junction. The round is clipped to the cavity so it cannot
 * cross an outer wall or protrude through an open face. Where a wall is lower
 * than the rim, a stack of slabs above its top traces a
 * concave quarter-round ramp into everything taller that it touches: the
 * "material" region (outer walls + grid dividers = clip − cavity, plus any
 * taller inner wall's footprint) is dilated by the arc inset at each slab
 * height and intersected with the wall's own footprint. Slabs shrink with
 * height, so each overshoots CSG_EPSILON DOWNWARD into the strictly-larger
 * slab (or main wall) below it, per the containment rule.
 */
function buildInnerWallsManifold(
  wasm: ManifoldToplevel, walls: InnerWall[], clipCS: CrossSection, cavityCS: CrossSection,
  totalHeight: number, filletR: number,
): Manifold[] {
  const floorZ = BASE_TOTAL_HEIGHT + FLOOR_THICKNESS;
  const planned: { rawFootprint: CrossSection; footprint: CrossSection; top: number }[] = [];
  for (const w of walls) {
    const quad = innerWallQuad(w);
    if (!quad) continue;
    const rawFootprint = new wasm.CrossSection([quad]);
    const footprint = rawFootprint.intersect(clipCS);
    if (footprint.isEmpty()) continue;
    planned.push({ rawFootprint, footprint, top: innerWallTop(w, floorZ, totalHeight) });
  }

  const solids: Manifold[] = [];
  const baseMaterial = clipCS.subtract(cavityCS);
  planned.forEach((w, i) => {
    const bottom = floorZ - WALL_EMBED;
    solids.push(w.footprint.extrude(w.top - bottom).translate([0, 0, bottom]));

    const baseFilletR = Math.min(filletR, w.top - floorZ);
    if (baseFilletR > 0) {
      const fillet = buildFloorFillet(
        wasm, baseFilletR, floorZ,
        (distance) => distance > 0.001
          ? w.rawFootprint.offset(distance, 'Round', 2, FILLET_SEGMENTS)
          : w.rawFootprint,
        cavityCS,
      );
      if (fillet) solids.push(fillet);
    }

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
    pegSections(wasm, x * GRID_PITCH + GRID_PITCH / 2, y * GRID_PITCH + GRID_PITCH / 2),
  );
  // Flush at z = PEG_HEIGHT: safe only because both sides land on the identical
  // coordinate — 4.75 is exactly representable, so the float32-quantized peg
  // vertices and this double-precision extrude sit on the same plane and the
  // boolean fuses the interface. Flush junctions whose z comes from differing
  // float expressions do NOT fuse (see the fillet stack in buildCavityManifold).
  solids.push(outerCS.extrude(totalHeight - PEG_HEIGHT).translate([0, 0, PEG_HEIGHT]));
  let bin = Manifold.union(solids);

  const wholeWalls = resolveWalls(binCells, binCells, config);
  const plan = planCavity(cells, binCells, walls, wholeWalls, config.wallThickness, Math.max(rc, filletR) + 1);
  const cavity = buildCavityManifold(wasm, plan, rc, filletR, totalHeight);
  if (cavity) {
    bin = bin.subtract(cavity.solid);

    // Interior additions live inside the cavity: free-form inner walls and the
    // sloped-base wedge. All overlap into existing material (floor embed, wall
    // band clip), so the unions fuse through real volume.
    const additions: Manifold[] = buildInnerWallsManifold(
      wasm, config.innerWalls ?? [], outerCS, cavity.cs, totalHeight, filletR);
    const wedge = buildSlopedBaseManifold(slope, binCells, outerCS, cavity.cs, totalHeight);
    if (wedge) additions.push(wedge);
    if (additions.length) bin = Manifold.union([bin, ...additions]);
  }

  // Fastener pockets (magnet recess and/or M3 pilot), subtracted as one union.
  const holes: Manifold[] = [
    ...(config.magnetHoles ? buildFastenerHoles(wasm, cells, MAGNET_RADIUS, MAGNET_DEPTH, 32) : []),
    ...(config.screwHoles  ? buildFastenerHoles(wasm, cells, SCREW_RADIUS,  SCREW_DEPTH,  16) : []),
  ];
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

function previewClipBox(
  wasm: ManifoldToplevel,
  bounds: ReturnType<typeof cellBounds>, totalHeight: number,
  insetX: boolean, insetY: boolean,
): Manifold {
  const padding = 1;
  const minX = bounds.minX + (insetX ? PREVIEW_INSET : -padding);
  const maxX = bounds.maxX - (insetX ? PREVIEW_INSET : -padding);
  const minY = bounds.minY + (insetY ? PREVIEW_INSET : -padding);
  const maxY = bounds.maxY - (insetY ? PREVIEW_INSET : -padding);
  return wasm.Manifold.cube([maxX - minX, maxY - minY, totalHeight + padding * 2])
    .translate([minX, minY, -padding]);
}

/**
 * Preview-only clip that shaves seam sides without deforming the piece.
 * Scaling the finished solid would deform rounded and concave corners where a
 * seam terminates; clipping preserves every surface away from the shave.
 */
function clipPreviewManifold(
  wasm: ManifoldToplevel, solid: Manifold, bounds: ReturnType<typeof cellBounds>,
  totalHeight: number, insetX: boolean, insetY: boolean,
): Manifold {
  if (!insetX && !insetY) return solid;
  return solid.intersect(previewClipBox(wasm, bounds, totalHeight, insetX, insetY));
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
  return repairMesh({ vertProperties: vp, triVerts: tv });
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
 * Ignores split lines — every logical bin as one solid, unioned into a single
 * mesh. Use generateBinPieces for the split-aware path.
 */
export function generateBinManifold(wasm: ManifoldToplevel, config: BinConfig): BinMesh {
  if (config.bins.length === 0) {
    return manifoldMesh(wasm.Manifold.cube([1, 1, 1]));
  }
  const solids = config.bins.map((bin) => {
    const binOuterCS = buildOuterProfile(wasm, bin.cells);
    return generatePieceManifold(wasm, config, bin.cells, bin.cells, binOuterCS,
      resolveWalls(bin.cells, bin.cells, config), bin.slope);
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
  mesh: BinMesh;   // whole-layout coordinates, mirrored to match the canvas
}

/**
 * Split-aware build: partitions each logical bin by its owned split lines
 * and generates every piece as an independent watertight solid. Seam faces
 * are open (walled only where the user placed a divider on the split line) so
 * glued pieces form one continuous bin; edges between DIFFERENT logical bins
 * are ordinary perimeter walls. Every piece keeps its own base pegs.
 *
 * Preview pieces are inset 0.15 mm per side on axes split by their logical bin,
 * then concatenated per bin so split seams appear as subtle physical gaps.
 *
 * Every output mesh (pieces and previews) is mirrored via mirrorMeshY so the
 * part matches the canvas drawing instead of its chiral mirror.
 */
export function generateBinPieces(
  wasm: ManifoldToplevel, config: BinConfig,
): { pieces: BinPiece[]; previews: BinPreview[] } {
  if (config.bins.length === 0) {
    const mesh = generateBinManifold(wasm, config);
    return { pieces: [{ name: pieceName(0, 1, 0, 1), col: 0, row: 0, mesh }], previews: [{ bin: 0, mesh }] };
  }

  const allCells = flattenBins(config.bins);
  const layoutH = (Math.max(...allCells.map((c) => c.y)) + 1) * GRID_PITCH;
  const bins = config.bins;
  const pieces: BinPiece[] = [];
  const previews: BinPreview[] = [];
  const totalHeight = totalHeightOf(config);
  const partsByBin = bins.map((bin) => partitionCells(bin.cells, bin.splitLines));
  bins.forEach((bin, bi) => {
    const parts = partsByBin[bi];
    const insetX = bin.splitLines.some((line) => line.axis === 'x');
    const insetY = bin.splitLines.some((line) => line.axis === 'y');
    // Whole-bin spec profile, built once and shared by every piece of this bin.
    const binOuterCS = buildOuterProfile(wasm, bin.cells);
    const binPreviewMeshes: BinMesh[] = [];
    parts.forEach((part, i) => {
      const solid = generatePieceManifold(
        wasm, config, part.cells, bin.cells, binOuterCS,
        resolveWalls(part.cells, bin.cells, config), bin.slope);
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
      const previewMesh = manifoldMesh(clipPreviewManifold(
        wasm, solid, cellBounds(part.cells), totalHeight, insetX, insetY));
      binPreviewMeshes.push(mirrorMeshY(previewMesh, layoutH));
    });
    previews.push({ bin: bin.id, mesh: concatMeshes(binPreviewMeshes) });
  });

  return { pieces, previews };
}

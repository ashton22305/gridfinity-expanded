import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  GRIDFINITY_DERIVED,
  GRIDFINITY_SPEC,
} from '../gridfinitySpec';
import type {
  Bin,
  BinParameters,
  Cell,
  Edge,
  FastenerSettings,
  Wall,
} from '../types';
import { manifoldTriangles } from './manifold';

const PITCH = GRIDFINITY_SPEC.gridPitch;
const BASE = GRIDFINITY_SPEC.baseProfile;
const FILLET_SEGMENTS = 32;
/** Collapses sub-micron boolean slivers; far below visible or sliceable size. */
const SLIVER_EPSILON = 1e-3;
type Polygon = [number, number][];

function roundedRect(
  wasm: ManifoldToplevel,
  width: number,
  height: number,
  radius: number,
): CrossSection {
  return wasm.CrossSection.square([width - radius * 2, height - radius * 2], true)
    .offset(radius, 'Round', 2, FILLET_SEGMENTS);
}

function profilePoints(profile: CrossSection, z: number): [number, number, number][] {
  return profile.toPolygons().flatMap((polygon) =>
    polygon.map(([x, y]) => [x, y, z] as [number, number, number]));
}

function loft(
  wasm: ManifoldToplevel,
  lower: CrossSection,
  lowerZ: number,
  upper: CrossSection,
  upperZ: number,
): Manifold {
  return wasm.Manifold.hull([
    ...profilePoints(lower, lowerZ),
    ...profilePoints(upper, upperZ),
  ]);
}

/** Canonical Gridfinity base centered on the origin. */
function canonicalBase(wasm: ManifoldToplevel): Manifold {
  const bottom = roundedRect(wasm, BASE.bottomWidth, BASE.bottomWidth, BASE.bottomRadius);
  const middle = roundedRect(wasm, BASE.middleWidth, BASE.middleWidth, BASE.middleRadius);
  const top = roundedRect(
    wasm,
    GRIDFINITY_SPEC.outerTopWidth,
    GRIDFINITY_SPEC.outerTopWidth,
    GRIDFINITY_SPEC.outerCornerRadius,
  );
  return wasm.Manifold.union([
    loft(wasm, bottom, 0, middle, BASE.lowerChamferHeight),
    middle
      .extrude(BASE.upperChamferStart - BASE.lowerChamferHeight)
      .translate([0, 0, BASE.lowerChamferHeight]),
    loft(wasm, middle, BASE.upperChamferStart, top, BASE.height),
  ]);
}

function cellFootprint(wasm: ManifoldToplevel, cells: Cell[]): CrossSection {
  return wasm.CrossSection.union(cells.map((cell) =>
    wasm.CrossSection.square([PITCH, PITCH])
      .translate([cell.x * PITCH, cell.y * PITCH])));
}

function closeReentrantCorners(
  wasm: ManifoldToplevel,
  footprint: CrossSection,
  radius: number,
  includeHoleCorners = true,
): CrossSection {
  return wasm.CrossSection.union(footprint.decompose().map((region) => {
    const corners = region.toPolygons().flatMap((polygon) => {
      const signedArea = polygon.reduce((area, point, index) => {
        const next = polygon[(index + 1) % polygon.length];
        return area + point[0] * next[1] - point[1] * next[0];
      }, 0);
      if (!includeHoleCorners && signedArea < 0) return [];
      return polygon.filter((point, index) => {
        const previous = polygon[(index + polygon.length - 1) % polygon.length];
        const next = polygon[(index + 1) % polygon.length];
        return (point[0] - previous[0]) * (next[1] - point[1]) -
          (point[1] - previous[1]) * (next[0] - point[0]) < -1e-9;
      });
    });
    if (corners.length === 0) return region;

    const closed = region
      .offset(radius, 'Round', 2, FILLET_SEGMENTS)
      .offset(-radius, 'Round', 2, FILLET_SEGMENTS);
    const cornerEnvelope = wasm.CrossSection.union(corners.map((corner) =>
      wasm.CrossSection.circle(radius + SLIVER_EPSILON, FILLET_SEGMENTS).translate(corner)));
    return region.add(closed.intersect(cornerEnvelope));
  }));
}

function outerFootprint(
  wasm: ManifoldToplevel,
  sharedFootprint: CrossSection,
): CrossSection {
  const footprint = sharedFootprint
    .offset(
      -(GRIDFINITY_DERIVED.perimeterClearancePerSide + GRIDFINITY_SPEC.outerCornerRadius),
      'Square',
      2,
    )
    .offset(GRIDFINITY_SPEC.outerCornerRadius, 'Round', 2, FILLET_SEGMENTS);
  return closeReentrantCorners(wasm, footprint, GRIDFINITY_SPEC.outerCornerRadius, false);
}

function openingChannel(wasm: ManifoldToplevel, edge: Edge): CrossSection {
  return edge.orientation === 'h'
    ? wasm.CrossSection.square([PITCH, PITCH])
      .translate([edge.x * PITCH, edge.y * PITCH - PITCH / 2])
    : wasm.CrossSection.square([PITCH, PITCH])
      .translate([edge.x * PITCH - PITCH / 2, edge.y * PITCH]);
}

function wallFootprint(wasm: ManifoldToplevel, wall: Wall): CrossSection {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  const nx = -dy / length * wall.width / 2;
  const ny = dx / length * wall.width / 2;
  return new wasm.CrossSection([[
    [wall.start.x - nx, wall.start.y - ny],
    [wall.end.x - nx, wall.end.y - ny],
    [wall.end.x + nx, wall.end.y + ny],
    [wall.start.x + nx, wall.start.y + ny],
  ]]);
}

/** Complete trusted cavity footprint before its vertical floor fillet. */
function cavityFootprint(
  wasm: ManifoldToplevel,
  bin: BinParameters,
  sharedFootprint: CrossSection,
  perimeterThickness: number,
): CrossSection {
  let cavity = sharedFootprint.offset(
    -(GRIDFINITY_DERIVED.perimeterClearancePerSide + perimeterThickness),
    'Miter',
    2,
  );
  if (bin.openings.length > 0) {
    cavity = wasm.CrossSection.union([
      cavity,
      ...bin.openings.map((edge) => openingChannel(wasm, edge)),
    ]);
  }
  if (bin.walls.length > 0) {
    cavity = cavity.subtract(wasm.CrossSection.union(
      bin.walls.map((wall) => wallFootprint(wasm, wall)),
    ));
  }
  return cavity;
}

function signedArea(polygon: Polygon): number {
  return polygon.reduce((area, [x, y], index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + x * next[1] - y * next[0];
  }, 0);
}

function isConvex(polygon: Polygon): boolean {
  const orientation = Math.sign(signedArea(polygon));
  for (let index = 0; index < polygon.length; index++) {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = (current[0] - previous[0]) * (next[1] - current[1]) -
      (current[1] - previous[1]) * (next[0] - current[0]);
    if (cross * orientation < -1e-9) return false;
  }
  return true;
}

/**
 * Maximal boundary runs whose interior vertices all turn convexly. Runs break
 * at reflex vertices so no hull can bulge past the boundary there; a contour
 * without reflex vertices becomes one wrapped run so every edge is covered.
 */
function convexBoundaryChains(contour: Polygon): Polygon[] {
  const reflex: number[] = [];
  for (let index = 0; index < contour.length; index++) {
    const previous = contour[(index + contour.length - 1) % contour.length];
    const current = contour[index];
    const next = contour[(index + 1) % contour.length];
    const cross = (current[0] - previous[0]) * (next[1] - current[1]) -
      (current[1] - previous[1]) * (next[0] - current[0]);
    if (cross < -1e-9) reflex.push(index);
  }
  if (reflex.length === 0) return [[...contour, contour[0]]];
  return reflex.map((start, position) => {
    const end = reflex[(position + 1) % reflex.length];
    const chain: Polygon = [contour[start]];
    for (let index = (start + 1) % contour.length; ; index = (index + 1) % contour.length) {
      chain.push(contour[index]);
      if (index === end) break;
    }
    return chain;
  });
}

/**
 * Hulling half-balls placed along a convex boundary run equals that run's
 * Minkowski sum with the half-ball, plus the run's chord pocket, which must
 * itself lie inside the seed so the pocket stays covered by the core prism.
 * Runs whose pocket escapes the seed — wrapped loops, chords crossing holes
 * or nearby boundary — split until exact; a single segment has no pocket.
 */
function chainBandPieces(
  wasm: ManifoldToplevel,
  chain: Polygon,
  seed: CrossSection,
  halfBall: Manifold,
  upperZ: number,
): Manifold[] {
  if (chain.length > 2) {
    const pocket = signedArea(chain) < 0 ? [...chain].reverse() : chain;
    const pocketSection = new wasm.CrossSection([pocket]);
    const escaped = pocketSection.subtract(seed);
    const escapes = escaped.area() > 1e-9;
    pocketSection.delete();
    escaped.delete();
    if (escapes) {
      const middle = chain.length >> 1;
      return [
        ...chainBandPieces(wasm, chain.slice(0, middle + 1), seed, halfBall, upperZ),
        ...chainBandPieces(wasm, chain.slice(middle), seed, halfBall, upperZ),
      ];
    }
  }
  const balls = chain.map(([x, y]) => halfBall.translate([x, y, upperZ]));
  const hull = wasm.Manifold.hull(balls);
  balls.forEach((ball) => ball.delete());
  return [hull];
}

function sphericalSweep(
  seed: CrossSection,
  sphere: Manifold,
  height: number,
  upperZ: number,
): Manifold {
  const rawExtrusion = seed.extrude(height - upperZ);
  const extrusion = rawExtrusion.translate([0, 0, upperZ]);
  const result = extrusion.minkowskiSum(sphere);
  rawExtrusion.delete();
  extrusion.delete();
  return result;
}

function roundedCavity(
  wasm: ManifoldToplevel,
  footprint: CrossSection,
  radius: number,
  height: number,
): Manifold {
  const floorZ = GRIDFINITY_SPEC.baseHeight + GRIDFINITY_SPEC.floorThickness;
  if (radius === 0) {
    return footprint.extrude(height - floorZ).translate([0, 0, floorZ]);
  }

  const upperZ = floorZ + radius;
  const closedFootprint = closeReentrantCorners(wasm, footprint, radius);
  const rawSeed = closedFootprint.offset(-radius, 'Round', 2, FILLET_SEGMENTS);
  const seed = rawSeed.simplify();
  closedFootprint.delete();
  rawSeed.delete();
  const sphere = wasm.Manifold.sphere(radius, FILLET_SEGMENTS);

  const contours = seed.toPolygons();
  if (contours.length === 1 && isConvex(contours[0])) {
    const result = sphericalSweep(seed, sphere, height, upperZ);
    seed.delete();
    sphere.delete();
    return result;
  }

  // Only the sweep's fillet band, from the floor to the sphere's tangent
  // height, shapes the cavity; the straight walls above it are a prism. The
  // band is the seed's area prism plus its boundary swept by the sphere's
  // lower half, assembled from per-chain hulls instead of area sweeps so the
  // union's operands hold no redundant interior sphere geometry.
  const halfBall = sphere.trimByPlane([0, 0, -1], 0);
  sphere.delete();
  const rawCore = seed.extrude(radius);
  const pieces: Manifold[] = [rawCore.translate([0, 0, floorZ])];
  rawCore.delete();
  for (const contour of contours) {
    for (const chain of convexBoundaryChains(contour)) {
      pieces.push(...chainBandPieces(wasm, chain, seed, halfBall, upperZ));
    }
  }
  halfBall.delete();
  const band = wasm.Manifold.union(pieces);
  pieces.forEach((piece) => piece.delete());
  // The wall prism reproduces the band's own top cross-section, so wall and
  // fillet discretizations agree exactly. Its base sits below the band's cap
  // by less than the extraction weld grid, so the overlap seam quantizes onto
  // the cap plane and collapses; it overshoots the open top like partCutter.
  const seamZ = upperZ - SLIVER_EPSILON / 1000;
  const wall = band.slice(seamZ);
  const rawPrism = wall.extrude(height + 1 - seamZ);
  const prism = rawPrism.translate([0, 0, seamZ]);
  const result = band.add(prism);
  seed.delete();
  wall.delete();
  rawPrism.delete();
  prism.delete();
  band.delete();
  return result;
}

const HARDWARE_OFFSET = GRIDFINITY_SPEC.hardware.centerOffset;
const HARDWARE_OFFSETS: [number, number][] = [
  [-HARDWARE_OFFSET, -HARDWARE_OFFSET],
  [-HARDWARE_OFFSET, HARDWARE_OFFSET],
  [HARDWARE_OFFSET, -HARDWARE_OFFSET],
  [HARDWARE_OFFSET, HARDWARE_OFFSET],
];

function canonicalHardwareCutter(
  wasm: ManifoldToplevel,
  radius: number,
  depth: number,
  segments: number,
): Manifold {
  return wasm.Manifold.union(HARDWARE_OFFSETS.map(([x, y]) =>
    wasm.Manifold.cylinder(depth, radius, radius, segments).translate([x, y, 0])));
}

function hardwareCutters(
  wasm: ManifoldToplevel,
  fasteners: FastenerSettings,
  cells: Cell[],
): Manifold[] {
  const hardware = GRIDFINITY_SPEC.hardware;
  const canonical = [
    ...(fasteners.magnets ? [canonicalHardwareCutter(
      wasm,
      hardware.magnet.recessDiameter / 2,
      hardware.magnet.recessDepth,
      32,
    )] : []),
    ...(fasteners.m3 ? [canonicalHardwareCutter(
      wasm,
      hardware.m3.recessDiameter / 2,
      hardware.m3.recessDepth,
      16,
    )] : []),
  ];
  return cells.flatMap((cell) => canonical.map((cutter) => cutter.translate([
    cell.x * PITCH + PITCH / 2,
    cell.y * PITCH + PITCH / 2,
    0,
  ])));
}

function buildBinSolid(
  wasm: ManifoldToplevel,
  bin: BinParameters,
  base: Manifold,
): Manifold {
  const footprint = cellFootprint(wasm, bin.cells);
  const bases = bin.cells.map((cell) => base.translate([
    cell.x * PITCH + PITCH / 2,
    cell.y * PITCH + PITCH / 2,
    0,
  ]));
  const body = outerFootprint(wasm, footprint)
    .extrude(bin.height - BASE.height)
    .translate([0, 0, BASE.height]);
  let solid = wasm.Manifold.union([...bases, body]);
  solid = solid.subtract(roundedCavity(
    wasm,
    cavityFootprint(wasm, bin, footprint, bin.perimeterThickness),
    bin.filletRadius,
    bin.height,
  ));
  const cutters = hardwareCutters(wasm, bin.fasteners, bin.cells);
  if (cutters.length > 0) solid = solid.subtract(wasm.Manifold.union(cutters));
  return solid;
}

/** Vertically overshoot the solid so cutter planes never coincide with its faces. */
function partCutter(
  wasm: ManifoldToplevel,
  cells: Cell[],
  height: number,
): Manifold {
  return cellFootprint(wasm, cells).extrude(height + 2).translate([0, 0, -1]);
}

/** Build finished solids from trusted parameters and return cut pieces grouped per bin. */
export function generateGeometry(
  wasm: ManifoldToplevel,
  bins: BinParameters[],
): Bin[] {
  const base = canonicalBase(wasm);
  return bins.map((bin) => {
    const solid = buildBinSolid(wasm, bin, base);
    return {
      binId: bin.binId,
      pieces: bin.pieces.map((cells) => {
        const piece = bin.pieces.length === 1
          ? solid
          : solid.intersect(partCutter(wasm, cells, bin.height));
        return {
          triangles: manifoldTriangles(piece.simplify(SLIVER_EPSILON)),
          cells,
        };
      }),
    };
  });
}

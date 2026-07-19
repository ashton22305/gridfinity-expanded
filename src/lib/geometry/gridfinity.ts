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

/**
 * Configuration-independent solids rebuilt identically on every generation,
 * cached for the worker's lifetime. Cached manifolds are never deleted and
 * callers must not delete them or solids derived from them by translation.
 */
interface ConstantSolids {
  base?: Manifold;
  filletSpheres: Map<number, Manifold>;
}

const constantSolids = new WeakMap<ManifoldToplevel, ConstantSolids>();

function constantsFor(wasm: ManifoldToplevel): ConstantSolids {
  let constants = constantSolids.get(wasm);
  if (!constants) {
    constants = { filletSpheres: new Map() };
    constantSolids.set(wasm, constants);
  }
  return constants;
}

function filletSphere(wasm: ManifoldToplevel, radius: number): Manifold {
  const constants = constantsFor(wasm);
  let sphere = constants.filletSpheres.get(radius);
  if (!sphere) {
    sphere = wasm.Manifold.sphere(radius, FILLET_SEGMENTS);
    constants.filletSpheres.set(radius, sphere);
  }
  return sphere;
}

/** Canonical Gridfinity base centered on the origin. */
function canonicalBase(wasm: ManifoldToplevel): Manifold {
  const constants = constantsFor(wasm);
  if (constants.base) return constants.base;
  const bottom = roundedRect(wasm, BASE.bottomWidth, BASE.bottomWidth, BASE.bottomRadius);
  const middle = roundedRect(wasm, BASE.middleWidth, BASE.middleWidth, BASE.middleRadius);
  const top = roundedRect(
    wasm,
    GRIDFINITY_SPEC.outerTopWidth,
    GRIDFINITY_SPEC.outerTopWidth,
    GRIDFINITY_SPEC.outerCornerRadius,
  );
  constants.base = wasm.Manifold.union([
    loft(wasm, bottom, 0, middle, BASE.lowerChamferHeight),
    middle
      .extrude(BASE.upperChamferStart - BASE.lowerChamferHeight)
      .translate([0, 0, BASE.lowerChamferHeight]),
    loft(wasm, middle, BASE.upperChamferStart, top, BASE.height),
  ]);
  // Force evaluation now so later booleans reuse the cached mesh.
  constants.base.numVert();
  return constants.base;
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

/** Latitude steps of the floor fillet, matching a 32-segment sphere. */
const FILLET_RINGS = FILLET_SEGMENTS / 4;

/** Nearest point on any contour segment to the given point. */
function nearestOnContours(
  contours: Polygon[],
  x: number,
  y: number,
): [number, number] {
  let best: [number, number] = contours[0][0];
  let bestDistance = Infinity;
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index++) {
      const [ax, ay] = contour[index];
      const [bx, by] = contour[(index + 1) % contour.length];
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0
        ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq))
        : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const distance = (x - px) * (x - px) + (y - py) * (y - py);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [px, py];
      }
    }
  }
  return best;
}

/**
 * One cavity region as a single closed mesh: the floor fillet as latitude
 * rings interpolated along nearest-point projection fibers between the
 * region and its wall polygon, straight walls above, and triangulated caps.
 * Every wall vertex lies exactly the fillet radius from the region and
 * projection fibers never cross, so the ring interpolation q + (w − q)·sin φ
 * traces the exact spherical sweep surface, with sphere corners emerging
 * where fibers fan around a region vertex. A single mesh has no seams, so
 * the final subtract meets it transversally everywhere — no boolean chatter
 * and no floor terraces. Returns null when a wall vertex projects
 * discontinuously (a waist narrower than the sweep diameter); the caller
 * falls back to the Minkowski sweep for that region.
 */
function sweptRegionMesh(
  wasm: ManifoldToplevel,
  region: CrossSection,
  radius: number,
  floorZ: number,
  topZ: number,
): Manifold | null {
  const upperZ = floorZ + radius;
  const seedPolygons = region.toPolygons();
  const rawWall = region.offset(radius, 'Round', 2, FILLET_SEGMENTS);
  const wall = rawWall.simplify();
  rawWall.delete();
  const wallPolygons = wall.toPolygons();
  wall.delete();

  const vertices: number[] = [];
  const addVertex = (x: number, y: number, z: number): number => {
    vertices.push(x, y, z);
    return vertices.length / 3 - 1;
  };
  const triangles: number[] = [];
  const emit = (a: number, b: number, c: number) => {
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  };

  const floorPolygons: Polygon[] = [];
  const floorIndices: number[][] = [];
  const topPolygons: Polygon[] = [];
  const topIndices: number[][] = [];

  for (const contour of wallPolygons) {
    if (contour.length < 3) continue;
    const projections = contour.map(([x, y]) => nearestOnContours(seedPolygons, x, y));
    for (let index = 0; index < contour.length; index++) {
      const next = (index + 1) % contour.length;
      const wallStep = Math.hypot(
        contour[next][0] - contour[index][0],
        contour[next][1] - contour[index][1],
      );
      const seedStep = Math.hypot(
        projections[next][0] - projections[index][0],
        projections[next][1] - projections[index][1],
      );
      // Concave trims stretch and skip projections by a few chord lengths;
      // a genuine fiber discontinuity (a waist narrower than the sweep
      // diameter) jumps by about the sweep diameter, so a radius-scaled
      // threshold separates the two. Stitching across a discontinuity would
      // bridge the waist.
      if (seedStep > 2.5 * wallStep + radius / 2) return null;
    }

    // rings[k][i]: vertex at latitude k above wall vertex i; ring 0
    // deduplicates fibers that collapse onto one region vertex, closing
    // sphere-corner fans by index instead of by coincident vertices.
    const rings: number[][] = [];
    const floorKeys = new Map<string, number>();
    for (let k = 0; k <= FILLET_RINGS; k++) {
      const phi = (k * Math.PI) / (2 * FILLET_RINGS);
      const scale = Math.sin(phi);
      const z = upperZ - radius * Math.cos(phi);
      rings.push(contour.map(([x, y], index) => {
        const [qx, qy] = projections[index];
        const vx = qx + (x - qx) * scale;
        const vy = qy + (y - qy) * scale;
        if (k > 0) return addVertex(vx, vy, z);
        const key = `${vx},${vy}`;
        let existing = floorKeys.get(key);
        if (existing === undefined) {
          existing = addVertex(vx, vy, z);
          floorKeys.set(key, existing);
        }
        return existing;
      }));
    }
    const top = contour.map(([x, y]) => addVertex(x, y, topZ));

    for (let index = 0; index < contour.length; index++) {
      const next = (index + 1) % contour.length;
      for (let k = 0; k < FILLET_RINGS; k++) {
        emit(rings[k][index], rings[k][next], rings[k + 1][next]);
        emit(rings[k][index], rings[k + 1][next], rings[k + 1][index]);
      }
      emit(rings[FILLET_RINGS][index], rings[FILLET_RINGS][next], top[next]);
      emit(rings[FILLET_RINGS][index], top[next], top[index]);
    }

    const floorContour: number[] = [];
    for (const ringIndex of rings[0]) {
      if (floorContour[floorContour.length - 1] !== ringIndex) floorContour.push(ringIndex);
    }
    while (floorContour.length > 1 && floorContour[0] === floorContour[floorContour.length - 1]) {
      floorContour.pop();
    }
    if (floorContour.length >= 3) {
      floorPolygons.push(floorContour.map((v) =>
        [vertices[v * 3], vertices[v * 3 + 1]] as [number, number]));
      floorIndices.push(floorContour);
    }
    topPolygons.push(contour);
    topIndices.push(top);
  }

  for (const [polygons, indices, upward] of [
    [floorPolygons, floorIndices, false],
    [topPolygons, topIndices, true],
  ] as const) {
    if (polygons.length === 0) continue;
    const flat = indices.flat();
    for (const triangle of wasm.triangulate(polygons)) {
      const [a, b, c] = [flat[triangle[0]], flat[triangle[1]], flat[triangle[2]]];
      if (upward) emit(a, b, c);
      else emit(c, b, a);
    }
  }

  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(triangles),
  });
  const solid = new wasm.Manifold(mesh);
  if (solid.numVert() === 0) {
    solid.delete();
    return null;
  }
  return solid;
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

  const regions = seed.decompose();
  if (regions.length === 0) {
    const empty = seed.extrude(radius);
    seed.delete();
    return empty;
  }
  const cavities = regions.map((region) => {
    const swept = sweptRegionMesh(wasm, region, radius, floorZ, height + 1);
    if (swept) return swept;
    return sphericalSweep(region, filletSphere(wasm, radius), height, upperZ);
  });
  regions.forEach((region) => region.delete());
  seed.delete();
  if (cavities.length === 1) return cavities[0];
  const result = wasm.Manifold.union(cavities);
  cavities.forEach((cavity) => cavity.delete());
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

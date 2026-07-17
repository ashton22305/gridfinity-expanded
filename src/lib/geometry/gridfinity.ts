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

function outerFootprint(wasm: ManifoldToplevel, cells: Cell[]): CrossSection {
  return cellFootprint(wasm, cells)
    .offset(
      -(GRIDFINITY_DERIVED.perimeterClearancePerSide + GRIDFINITY_SPEC.outerCornerRadius),
      'Square',
      2,
    )
    .offset(GRIDFINITY_SPEC.outerCornerRadius, 'Round', 2, FILLET_SEGMENTS);
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
  perimeterThickness: number,
): CrossSection {
  let cavity = cellFootprint(wasm, bin.cells).offset(
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
  const seed = footprint
    .offset(-radius, 'Round', 2, FILLET_SEGMENTS)
    .extrude(height - upperZ)
    .translate([0, 0, upperZ]);
  return seed.minkowskiSum(wasm.Manifold.sphere(radius, FILLET_SEGMENTS));
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
  const bases = bin.cells.map((cell) => base.translate([
    cell.x * PITCH + PITCH / 2,
    cell.y * PITCH + PITCH / 2,
    0,
  ]));
  const body = outerFootprint(wasm, bin.cells)
    .extrude(bin.height - BASE.height)
    .translate([0, 0, BASE.height]);
  let solid = wasm.Manifold.union([...bases, body]);
  solid = solid.subtract(roundedCavity(
    wasm,
    cavityFootprint(wasm, bin, bin.perimeterThickness),
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

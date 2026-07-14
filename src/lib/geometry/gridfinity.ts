import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { editorBinToModel, editorCellToModel } from '../coordinates';
import { partitionCells } from '../cuts';
import { cellSet, edgeInsideCell, edgeKey, perimeterEdges } from '../edges';
import {
  GRIDFINITY_DERIVED,
  GRIDFINITY_SPEC,
  IMPLEMENTATION_ALLOWANCES,
  gridfinityHeight,
} from '../gridfinitySpec';
import type {
  BinDesign,
  Cell,
  Cut,
  Design,
  Edge,
  GeneratedPart,
  Point2,
  TriangleMesh,
  Wall,
} from '../types';
import { manifoldMesh, repairMesh } from './manifold';

const PITCH = GRIDFINITY_SPEC.gridPitch;
const BASE = GRIDFINITY_SPEC.baseProfile;
const CSG_EPSILON = IMPLEMENTATION_ALLOWANCES.csgOverlap;
const WALL_EMBED = IMPLEMENTATION_ALLOWANCES.wallFloorEmbed;
const FILLET_SEGMENTS = 32;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PerimeterPlan {
  walled: Edge[];
  open: Edge[];
}

interface CavityPlan {
  cellSquares: Rect[];
  solidStrips: Rect[];
  openExtensions: Rect[];
}

function rectPoly(rect: Rect): [number, number][][] {
  return [[
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ]];
}

function roundedRect(
  wasm: ManifoldToplevel,
  cx: number,
  cy: number,
  width: number,
  height: number,
  radius: number,
): CrossSection {
  const core = wasm.CrossSection.square([width - radius * 2, height - radius * 2], true)
    .translate([cx, cy]);
  return radius <= 0 ? core : core.offset(radius, 'Round', 2, FILLET_SEGMENTS);
}

/** Individually closed base-profile primitives for one cell. */
function baseSections(wasm: ManifoldToplevel, cx: number, cy: number): Manifold[] {
  const bottom = roundedRect(
    wasm, cx, cy, BASE.bottomWidth, BASE.bottomWidth, BASE.bottomRadius,
  );
  const middle = roundedRect(
    wasm, cx, cy, BASE.middleWidth, BASE.middleWidth, BASE.middleRadius,
  );
  const top = roundedRect(
    wasm,
    cx,
    cy,
    GRIDFINITY_SPEC.outerTopWidth,
    GRIDFINITY_SPEC.outerTopWidth,
    GRIDFINITY_SPEC.outerCornerRadius,
  );
  const loft = (lower: CrossSection, z0: number, upper: CrossSection, z1: number) =>
    wasm.Manifold.hull([
      lower.extrude(CSG_EPSILON).translate([0, 0, z0]),
      upper.extrude(CSG_EPSILON).translate([0, 0, z1 - CSG_EPSILON]),
    ]);
  return [
    loft(bottom, 0, middle, BASE.lowerChamferHeight),
    middle
      .extrude(BASE.upperChamferStart - BASE.lowerChamferHeight)
      .translate([0, 0, BASE.lowerChamferHeight]),
    loft(middle, BASE.upperChamferStart, top, BASE.height),
  ];
}

/** One spec-compatible outer profile, including valid enclosed holes. */
function buildOuterProfile(wasm: ManifoldToplevel, cells: Cell[]): CrossSection {
  const footprint = wasm.CrossSection.union(cells.map((cell) =>
    wasm.CrossSection.square([PITCH, PITCH])
      .translate([cell.x * PITCH, cell.y * PITCH])));
  return footprint
    .offset(
      -(GRIDFINITY_DERIVED.perimeterClearancePerSide + GRIDFINITY_SPEC.outerCornerRadius),
      'Square',
      2,
    )
    .offset(GRIDFINITY_SPEC.outerCornerRadius, 'Round', 2, FILLET_SEGMENTS);
}

function resolvePerimeter(bin: BinDesign): PerimeterPlan {
  const openKeys = new Set(bin.openings.map(edgeKey));
  const walled: Edge[] = [];
  const open: Edge[] = [];
  for (const edge of perimeterEdges(bin.cells)) {
    (openKeys.has(edgeKey(edge)) ? open : walled).push(edge);
  }
  return { walled, open };
}

function planCavity(
  cells: Cell[],
  perimeter: PerimeterPlan,
  perimeterThickness: number,
  extensionDepth: number,
): CavityPlan {
  const stripDepth = GRIDFINITY_DERIVED.perimeterClearancePerSide + perimeterThickness;
  const outwardSlop = 1;
  const cellsSet = cellSet(cells);
  const cellSquares = cells.map((cell) => ({
    x: cell.x * PITCH,
    y: cell.y * PITCH,
    w: PITCH,
    h: PITCH,
  }));
  const solidStrips: Rect[] = [];
  const openExtensions: Rect[] = [];

  for (const edge of perimeter.walled) {
    const inside = edgeInsideCell(cellsSet, edge)!;
    if (edge.orientation === 'h') {
      const below = inside.y === edge.y - 1;
      solidStrips.push({
        x: edge.x * PITCH,
        y: edge.y * PITCH - (below ? stripDepth : outwardSlop),
        w: PITCH,
        h: stripDepth + outwardSlop,
      });
    } else {
      const left = inside.x === edge.x - 1;
      solidStrips.push({
        x: edge.x * PITCH - (left ? stripDepth : outwardSlop),
        y: edge.y * PITCH,
        w: stripDepth + outwardSlop,
        h: PITCH,
      });
    }
  }

  for (const edge of perimeter.open) {
    const inside = edgeInsideCell(cellsSet, edge)!;
    if (edge.orientation === 'h') {
      const below = inside.y === edge.y - 1;
      openExtensions.push({
        x: edge.x * PITCH,
        y: edge.y * PITCH - (below ? 0 : extensionDepth),
        w: PITCH,
        h: extensionDepth,
      });
    } else {
      const left = inside.x === edge.x - 1;
      openExtensions.push({
        x: edge.x * PITCH - (left ? 0 : extensionDepth),
        y: edge.y * PITCH,
        w: extensionDepth,
        h: PITCH,
      });
    }
  }

  // Fill the material-side quadrant of fully walled concave corners. Without
  // this patch two edge strips meet only at one point and leave a cavity finger.
  const walledKeys = new Set(perimeter.walled.map(edgeKey));
  const lattice = new Set<string>();
  for (const cell of cells) {
    for (const [x, y] of [
      [cell.x, cell.y],
      [cell.x + 1, cell.y],
      [cell.x, cell.y + 1],
      [cell.x + 1, cell.y + 1],
    ]) {
      const latticeKey = `${x},${y}`;
      if (lattice.has(latticeKey)) continue;
      lattice.add(latticeKey);
      const quadrants: [number, number][] = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
      const absent = quadrants.filter(([dx, dy]) => !cellsSet.has(`${x + dx},${y + dy}`));
      if (absent.length !== 1) continue;
      const [dx, dy] = absent[0];
      if (!walledKeys.has(`v:${x},${y + dy}`) || !walledKeys.has(`h:${x + dx},${y}`)) continue;
      solidStrips.push({
        x: x * PITCH + (dx === 0 ? -stripDepth : 0),
        y: y * PITCH + (dy === 0 ? -stripDepth : 0),
        w: stripDepth,
        h: stripDepth,
      });
    }
  }

  return { cellSquares, solidStrips, openExtensions };
}

function clampOpeningRadius(profile: CrossSection, radius: number): number {
  const collapses = (value: number) => profile.offset(-value, 'Round', 2, 8).isEmpty();
  if (!collapses(radius)) return radius;
  if (collapses(0.25)) return 0;
  let low = 0.25;
  let high = radius;
  for (let index = 0; index < 8; index++) {
    const middle = (low + high) / 2;
    if (collapses(middle)) high = middle;
    else low = middle;
  }
  return low;
}

function buildFloorFillet(
  wasm: ManifoldToplevel,
  radius: number,
  floorZ: number,
  profileAt: (distance: number) => CrossSection,
  clip: CrossSection,
  bottomOverlap = 0,
): Manifold | null {
  if (radius <= 0) return null;
  const steps = Math.min(48, Math.max(8, Math.ceil(radius * 8)));
  const segments: Manifold[] = [];
  for (let step = 0; step < steps; step++) {
    const lowerHeight = radius * step / steps;
    const upperHeight = radius * (step + 1) / steps;
    const distanceAt = (height: number) =>
      radius - Math.sqrt(Math.max(0, 2 * radius * height - height * height));
    const lowerProfile = profileAt(distanceAt(lowerHeight));
    const upperProfile = profileAt(distanceAt(upperHeight));
    if (lowerProfile.isEmpty() || upperProfile.isEmpty()) continue;
    const lowerOverlap = step === 0 ? bottomOverlap : 0;
    for (const lowerComponent of lowerProfile.decompose()) {
      for (const upperComponent of upperProfile.decompose()) {
        if (lowerComponent.intersect(upperComponent).isEmpty()) continue;
        const lower = lowerComponent.extrude(CSG_EPSILON + lowerOverlap)
          .translate([
            0,
            0,
            floorZ + lowerHeight - lowerOverlap - CSG_EPSILON / 2,
          ]);
        const upper = upperComponent.extrude(CSG_EPSILON)
          .translate([0, 0, floorZ + upperHeight - CSG_EPSILON / 2]);
        const envelope = lowerComponent.add(upperComponent)
          .extrude(upperHeight - lowerHeight + CSG_EPSILON * 2 + lowerOverlap)
          .translate([
            0,
            0,
            floorZ + lowerHeight - CSG_EPSILON - lowerOverlap,
          ]);
        segments.push(wasm.Manifold.hull([lower, upper]).intersect(envelope));
      }
    }
  }
  if (segments.length === 0) return null;
  const clipSolid = clip.extrude(radius + CSG_EPSILON + bottomOverlap)
    .translate([0, 0, floorZ - CSG_EPSILON / 2 - bottomOverlap]);
  return wasm.Manifold.union(segments).intersect(clipSolid);
}

function buildCavity(
  wasm: ManifoldToplevel,
  plan: CavityPlan,
  filletRadius: number,
  totalHeight: number,
): { solid: Manifold; profile: CrossSection } | null {
  const CS = wasm.CrossSection;
  let raw = CS.union(plan.cellSquares.map(rectPoly));
  if (plan.solidStrips.length > 0) raw = raw.subtract(CS.union(plan.solidStrips.map(rectPoly)));
  if (raw.isEmpty()) return null;

  const extended = plan.openExtensions.length > 0
    ? CS.union([raw, ...plan.openExtensions.map(rectPoly)])
    : raw;
  const planarRadius = filletRadius > 0 ? clampOpeningRadius(extended, filletRadius) : 0;
  let opened = extended;
  let cavityProfile = raw;
  if (planarRadius > 0) {
    const rounded = extended
      .offset(-planarRadius, 'Round', 2, FILLET_SEGMENTS)
      .offset(planarRadius, 'Round', 2, FILLET_SEGMENTS)
      .simplify(IMPLEMENTATION_ALLOWANCES.meshWeldStep);
    const clipped = rounded.intersect(raw);
    if (!clipped.isEmpty()) {
      opened = rounded;
      cavityProfile = clipped;
    }
  }

  const floorZ = GRIDFINITY_SPEC.baseHeight + GRIDFINITY_SPEC.floorThickness;
  const cavityDepth = totalHeight - floorZ;
  const verticalRadius = Math.max(0, Math.min(filletRadius, cavityDepth));
  const solids: Manifold[] = [];
  if (verticalRadius > 0) {
    const fillet = buildFloorFillet(
      wasm,
      verticalRadius,
      floorZ,
      (distance) => distance > 0.001
        ? opened.offset(-distance, 'Miter', 2).intersect(cavityProfile)
        : cavityProfile,
      cavityProfile,
    );
    if (fillet) solids.push(fillet);
  }
  solids.push(cavityProfile
    .extrude(cavityDepth - verticalRadius + CSG_EPSILON)
    .translate([0, 0, floorZ + verticalRadius]));
  return { solid: wasm.Manifold.union(solids), profile: cavityProfile };
}

function wallQuad(wall: Wall): [number, number][] | null {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.1) return null;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const halfWidth = Math.max(0.4, wall.width) / 2;
  const start = {
    x: wall.start.x - ux * CSG_EPSILON,
    y: wall.start.y - uy * CSG_EPSILON,
  };
  const end = {
    x: wall.end.x + ux * CSG_EPSILON,
    y: wall.end.y + uy * CSG_EPSILON,
  };
  return [
    [start.x - nx * halfWidth, start.y - ny * halfWidth],
    [end.x - nx * halfWidth, end.y - ny * halfWidth],
    [end.x + nx * halfWidth, end.y + ny * halfWidth],
    [start.x + nx * halfWidth, start.y + ny * halfWidth],
  ];
}

function buildWalls(
  wasm: ManifoldToplevel,
  walls: Wall[],
  outerProfile: CrossSection,
  cavityProfile: CrossSection,
  totalHeight: number,
  filletRadius: number,
): Manifold[] {
  const floorZ = GRIDFINITY_SPEC.baseHeight + GRIDFINITY_SPEC.floorThickness;
  const solids: Manifold[] = [];
  for (const wall of walls) {
    const polygon = wallQuad(wall);
    if (!polygon) continue;
    const raw = new wasm.CrossSection([polygon]);
    const footprint = raw.intersect(outerProfile);
    if (footprint.isEmpty()) continue;
    const bottom = floorZ - WALL_EMBED;
    solids.push(footprint.extrude(totalHeight - bottom).translate([0, 0, bottom]));

    const radius = Math.min(filletRadius, totalHeight - floorZ);
    if (radius <= 0) continue;
    const fillet = buildFloorFillet(
      wasm,
      radius,
      floorZ,
      (distance) => distance > 0.001
        ? raw.offset(distance, 'Round', 2, FILLET_SEGMENTS)
        : raw,
      cavityProfile,
      WALL_EMBED,
    );
    if (fillet) solids.push(fillet);
  }
  return solids;
}

const HARDWARE_OFFSET = GRIDFINITY_SPEC.hardware.centerOffset;
const HARDWARE_OFFSETS: [number, number][] = [
  [-HARDWARE_OFFSET, -HARDWARE_OFFSET],
  [-HARDWARE_OFFSET, HARDWARE_OFFSET],
  [HARDWARE_OFFSET, -HARDWARE_OFFSET],
  [HARDWARE_OFFSET, HARDWARE_OFFSET],
];

function buildHardwareRecesses(
  wasm: ManifoldToplevel,
  cells: Cell[],
  radius: number,
  depth: number,
  segments: number,
): Manifold[] {
  return cells.flatMap((cell) => {
    const cx = cell.x * PITCH + PITCH / 2;
    const cy = cell.y * PITCH + PITCH / 2;
    return HARDWARE_OFFSETS.map(([dx, dy]) => wasm.Manifold
      .cylinder(depth + CSG_EPSILON, radius, radius, segments)
      .translate([cx + dx, cy + dy, 0]));
  });
}

/** Build one complete logical bin exactly once, before any cuts are applied. */
function buildBinSolid(
  wasm: ManifoldToplevel,
  design: Design,
  bin: BinDesign,
): Manifold {
  const totalHeight = gridfinityHeight(design.heightUnits);
  const outerProfile = buildOuterProfile(wasm, bin.cells);
  const positive: Manifold[] = bin.cells.flatMap((cell) =>
    baseSections(wasm, cell.x * PITCH + PITCH / 2, cell.y * PITCH + PITCH / 2));
  positive.push(outerProfile
    .extrude(totalHeight - BASE.height)
    .translate([0, 0, BASE.height]));
  let solid = wasm.Manifold.union(positive);

  const cavity = buildCavity(
    wasm,
    planCavity(
      bin.cells,
      resolvePerimeter(bin),
      design.perimeterThickness,
      design.filletRadius + 1,
    ),
    design.filletRadius,
    totalHeight,
  );
  if (cavity) {
    solid = solid.subtract(cavity.solid);
    const walls = buildWalls(
      wasm,
      bin.walls,
      outerProfile,
      cavity.profile,
      totalHeight,
      design.filletRadius,
    );
    if (walls.length > 0) solid = wasm.Manifold.union([solid, ...walls]);
  }

  const hardware = GRIDFINITY_SPEC.hardware;
  const recesses = [
    ...(design.fasteners.magnets
      ? buildHardwareRecesses(
        wasm,
        bin.cells,
        hardware.magnet.recessDiameter / 2,
        hardware.magnet.recessDepth,
        32,
      )
      : []),
    ...(design.fasteners.m3
      ? buildHardwareRecesses(
        wasm,
        bin.cells,
        hardware.m3.recessDiameter / 2,
        hardware.m3.recessDepth,
        16,
      )
      : []),
  ];
  if (recesses.length > 0) solid = solid.subtract(wasm.Manifold.union(recesses));
  return solid.simplify(IMPLEMENTATION_ALLOWANCES.meshWeldStep);
}

/** Slice the finished bin by the exact pitch-square footprint of one part. */
function slicePart(
  wasm: ManifoldToplevel,
  solid: Manifold,
  cells: Cell[],
  totalHeight: number,
): Manifold {
  const profile = wasm.CrossSection.union(cells.map((cell) =>
    wasm.CrossSection.square([PITCH, PITCH])
      .translate([cell.x * PITCH, cell.y * PITCH])));
  const cutter = profile
    .extrude(totalHeight + CSG_EPSILON * 2)
    .translate([0, 0, -CSG_EPSILON]);
  return solid.intersect(cutter).simplify(IMPLEMENTATION_ALLOWANCES.meshWeldStep);
}

function localizeMesh(mesh: TriangleMesh): { mesh: TriangleMesh; layoutPosition: Point2 } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  for (let index = 0; index < mesh.positions.length; index += 3) {
    minX = Math.min(minX, mesh.positions[index]);
    minY = Math.min(minY, mesh.positions[index + 1]);
    minZ = Math.min(minZ, mesh.positions[index + 2]);
  }
  const positions = new Float32Array(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] -= minX;
    positions[index + 1] -= minY;
    positions[index + 2] -= minZ;
  }
  return {
    mesh: repairMesh({ positions, indices: mesh.indices }),
    layoutPosition: { x: minX, y: minY },
  };
}

function previewOffsetFor(cells: Cell[], cuts: Cut[], partCount: number): Point2 {
  if (partCount <= 1) return { x: 0, y: 0 };
  const halfGap = IMPLEMENTATION_ALLOWANCES.multipartPreviewGap / 2;
  const verticalLines = new Set<number>();
  const horizontalLines = new Set<number>();
  for (const cut of cuts) {
    if (cut.start.x === cut.end.x) verticalLines.add(cut.start.x);
    else if (cut.start.y === cut.end.y) horizontalLines.add(cut.start.y);
  }
  let x = 0;
  let y = 0;
  for (const line of verticalLines) {
    if (cells.every((cell) => cell.x < line)) x -= halfGap;
    else if (cells.every((cell) => cell.x >= line)) x += halfGap;
  }
  for (const line of horizontalLines) {
    // Editor rows increase down, so the model-space direction is reversed.
    if (cells.every((cell) => cell.y < line)) y += halfGap;
    else if (cells.every((cell) => cell.y >= line)) y -= halfGap;
  }
  return { x, y };
}

function partFilename(binIndex: number, binCount: number, partIndex: number, partCount: number): string {
  const stem = binCount === 1 ? 'gridfinity-bin' : `gridfinity-bin-${binIndex + 1}`;
  return partCount === 1
    ? `${stem}.stl`
    : `${stem}-part-${partIndex + 1}-of-${partCount}.stl`;
}

/**
 * The only production generation path. Every returned mesh is extracted from
 * the finished sliced solid, localized into print coordinates, then repaired
 * at final Float32 precision. Preview and STL export consume these same arrays.
 */
export function generateDesignParts(
  wasm: ManifoldToplevel,
  design: Design,
): GeneratedPart[] {
  const parts: GeneratedPart[] = [];
  design.bins.forEach((editorBin, binIndex) => {
    const modelBin = editorBinToModel(editorBin);
    const fullSolid = buildBinSolid(wasm, design, modelBin);
    const editorParts = partitionCells(editorBin.cells, editorBin.cuts);
    editorParts.forEach((editorPart, partIndex) => {
      const modelCells = editorPart.cells.map(editorCellToModel);
      const sliced = slicePart(
        wasm,
        fullSolid,
        modelCells,
        gridfinityHeight(design.heightUnits),
      );
      const localized = localizeMesh(manifoldMesh(sliced));
      parts.push({
        id: `${editorBin.id}-part-${partIndex + 1}`,
        binId: editorBin.id,
        filename: partFilename(
          binIndex,
          design.bins.length,
          partIndex,
          editorParts.length,
        ),
        mesh: localized.mesh,
        layoutPosition: localized.layoutPosition,
        previewOffset: previewOffsetFor(editorPart.cells, editorBin.cuts, editorParts.length),
      });
    });
  });
  return parts;
}

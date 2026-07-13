/**
 * Manifold / printability validator for the Gridfinity generator.
 *
 * Runs the production build path — `generateBinManifold` — across the parameter
 * space and asserts every result is a closed, watertight 2-manifold: each edge
 * shared by exactly two oppositely-wound triangles, with no boundary edges,
 * degenerate triangles, or duplicate faces. It checks both the indexed mesh the
 * manifold engine returns and the binary STL the worker actually writes from it.
 *
 * Run with `npm run check:manifold`. Exits non-zero if any case is defective.
 */
import { generateBinManifold, generateBinPieces } from '../src/lib/geometry/gridfinity';
import { initManifold, type BinMesh } from '../src/lib/geometry/manifold';
import { meshToStl } from '../src/lib/export/stl';
import type { BinConfig, BinSlope, GridCell, GridEdge, SplitLine } from '../src/lib/types';

interface Report {
  triangles: number;
  degenerate: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  orientationErrors: number;
  duplicateFaces: number;
  membranes: number;
}

function analyzeIndexed(mesh: BinMesh): Report {
  const { vertProperties: vp, triVerts: tv } = mesh;
  const undirected = new Map<string, number>();
  const directed = new Map<string, number>();
  const faces = new Map<string, number>();
  let degenerate = 0;

  const area = (a: number, b: number, c: number) => {
    const ux = vp[b*3]-vp[a*3], uy = vp[b*3+1]-vp[a*3+1], uz = vp[b*3+2]-vp[a*3+2];
    const vx = vp[c*3]-vp[a*3], vy = vp[c*3+1]-vp[a*3+1], vz = vp[c*3+2]-vp[a*3+2];
    const cx = uy*vz-uz*vy, cy = uz*vx-ux*vz, cz = ux*vy-uy*vx;
    return Math.hypot(cx, cy, cz) / 2;
  };

  for (let i = 0; i < tv.length; i += 3) {
    const t = [tv[i], tv[i + 1], tv[i + 2]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2] || area(t[0], t[1], t[2]) < 1e-9) degenerate++;
    faces.set([...t].sort((a, b) => a - b).join(','), (faces.get([...t].sort((a, b) => a - b).join(',')) ?? 0) + 1);
    for (let j = 0; j < 3; j++) {
      const a = t[j], b = t[(j + 1) % 3];
      const u = a < b ? `${a}|${b}` : `${b}|${a}`;
      undirected.set(u, (undirected.get(u) ?? 0) + 1);
      directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0, nonManifoldEdges = 0, orientationErrors = 0;
  for (const [u, n] of undirected) {
    if (n < 2) { boundaryEdges++; continue; }
    if (n > 2) { nonManifoldEdges++; continue; }
    const [a, b] = u.split('|');
    if ((directed.get(`${a}>${b}`) ?? 0) !== 1 || (directed.get(`${b}>${a}`) ?? 0) !== 1) orientationErrors++;
  }
  let duplicateFaces = 0;
  for (const n of faces.values()) if (n > 1) duplicateFaces += n - 1;

  return {
    triangles: tv.length / 3, degenerate, boundaryEdges, nonManifoldEdges, orientationErrors,
    duplicateFaces, membranes: countMembranes(mesh),
  };
}

/**
 * Zero-thickness membranes: opposite-facing triangles lying in the same
 * geometric plane and covering the same region — paper-thin sheets inside the
 * solid. Every edge is still shared by exactly two oppositely-wound triangles,
 * so they pass the edge checks above, yet they z-fight in slicer viewports and
 * slice as phantom walls. (They arise when stacked slabs miss flush contact by
 * an ULP: the boolean keeps the sub-nanometre gap and the float32 output welds
 * its two sides into one plane.) A plane counts as a membrane when some
 * triangle's centroid lies ≥ 1 µm interior to an opposite-facing coplanar
 * triangle — requiring real two-sided coverage, so legitimately coplanar but
 * disjoint regions (e.g. a base flare beside a bridge underside) and sub-micron
 * contour-sampling slivers along shared walls don't trip it.
 */
function countMembranes(mesh: BinMesh): number {
  const { vertProperties: vp, triVerts: tv } = mesh;
  // 2D projection of a plane-pair's triangles: [ax, ay, bx, by, cx, cy][]
  type Tri2 = [number, number, number, number, number, number];
  const planes = new Map<string, [Tri2[], Tri2[]]>();  // [facing canonical direction, facing opposite]

  for (let i = 0; i < tv.length; i += 3) {
    const [p, q, r] = [tv[i] * 3, tv[i + 1] * 3, tv[i + 2] * 3];
    const ux = vp[q]-vp[p], uy = vp[q+1]-vp[p+1], uz = vp[q+2]-vp[p+2];
    const vx = vp[r]-vp[p], vy = vp[r+1]-vp[p+1], vz = vp[r+2]-vp[p+2];
    let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    nx /= len; ny /= len; nz /= len;
    // Canonical plane key: flip the normal so its first significant component
    // is positive; slot 0 collects triangles facing the canonical direction.
    const flip = nx < -1e-6 || (nx <= 1e-6 && (ny < -1e-6 || (ny <= 1e-6 && nz < 0)));
    const s = flip ? -1 : 1;
    const d = nx*vp[p] + ny*vp[p+1] + nz*vp[p+2];
    const key = `${Math.round(s*nx*1e3)},${Math.round(s*ny*1e3)},${Math.round(s*nz*1e3)},${Math.round(s*d*1e3)}`;

    // Project onto the two axes orthogonal to the dominant normal component.
    const dominant = Math.abs(nx) >= Math.abs(ny)
      ? (Math.abs(nx) >= Math.abs(nz) ? 0 : 2)
      : (Math.abs(ny) >= Math.abs(nz) ? 1 : 2);
    const [a1, a2] = dominant === 0 ? [1, 2] : dominant === 1 ? [0, 2] : [0, 1];

    let pair = planes.get(key);
    if (!pair) { pair = [[], []]; planes.set(key, pair); }
    pair[flip ? 1 : 0].push([vp[p+a1], vp[p+a2], vp[q+a1], vp[q+a2], vp[r+a1], vp[r+a2]]);
  }

  /** Is (px, py) at least `margin` interior to the 2D triangle (either winding)? */
  const inside = (t: Tri2, px: number, py: number, margin: number): boolean => {
    let sign = 0;
    for (let e = 0; e < 3; e++) {
      const x1 = t[(e*2) % 6], y1 = t[(e*2+1) % 6], x2 = t[(e*2+2) % 6], y2 = t[(e*2+3) % 6];
      const elen = Math.hypot(x2-x1, y2-y1);
      if (elen < 1e-12) return false;
      const dist = ((x2-x1)*(py-y1) - (y2-y1)*(px-x1)) / elen;  // signed distance to edge
      if (Math.abs(dist) < margin) return false;
      if (sign === 0) sign = Math.sign(dist);
      else if (Math.sign(dist) !== sign) return false;
    }
    return true;
  };

  let membranes = 0;
  for (const [front, back] of planes.values()) {
    if (!front.length || !back.length) continue;
    const [probe, cover] = front.length <= back.length ? [front, back] : [back, front];
    const covered = probe.some((t) => {
      const cx = (t[0]+t[2]+t[4]) / 3, cy = (t[1]+t[3]+t[5]) / 3;
      return cover.some((c) => inside(c, cx, cy, 1e-3));
    });
    if (covered) membranes++;
  }
  return membranes;
}

/** Boundary/non-manifold edge count of the serialized STL (welds float32 triangle soup). */
function stlBoundary(buf: ArrayBuffer): { boundary: number; nonManifold: number } {
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  const key = (x: number, y: number, z: number) => `${Math.round(x*1e4)},${Math.round(y*1e4)},${Math.round(z*1e4)}`;
  const und = new Map<string, number>();
  let o = 84;
  for (let i = 0; i < count; i++) {
    o += 12;
    const r = () => { const x = dv.getFloat32(o, true); o += 4; return x; };
    const ks = [key(r(), r(), r()), key(r(), r(), r()), key(r(), r(), r())];
    o += 2;
    for (let j = 0; j < 3; j++) { const a = ks[j], b = ks[(j + 1) % 3]; const u = a < b ? `${a}|${b}` : `${b}|${a}`; und.set(u, (und.get(u) ?? 0) + 1); }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of und.values()) { if (n < 2) boundary++; else if (n > 2) nonManifold++; }
  return { boundary, nonManifold };
}

/** Solid-angle containment test used by semantic probes away from boundaries. */
function containsPoint(mesh: BinMesh, [px, py, pz]: [number, number, number]): boolean {
  const { vertProperties: vp, triVerts: tv } = mesh;
  let angle = 0;
  for (let i = 0; i < tv.length; i += 3) {
    const a = tv[i] * 3, b = tv[i + 1] * 3, c = tv[i + 2] * 3;
    const ax = vp[a] - px, ay = vp[a + 1] - py, az = vp[a + 2] - pz;
    const bx = vp[b] - px, by = vp[b + 1] - py, bz = vp[b + 2] - pz;
    const cx = vp[c] - px, cy = vp[c + 1] - py, cz = vp[c + 2] - pz;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const numerator = ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const denominator = la * lb * lc
      + (ax * bx + ay * by + az * bz) * lc
      + (bx * cx + by * cy + bz * cz) * la
      + (cx * ax + cy * ay + cz * az) * lb;
    angle += 2 * Math.atan2(numerator, denominator);
  }
  return Math.abs(angle) > 2 * Math.PI;
}

const rect = (w: number, h: number): GridCell[] => {
  const c: GridCell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.push({ x, y });
  return c;
};
const L: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }];
const T: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
const staircase: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];  // corner-touching only
const disjoint: GridCell[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }];                   // separated cells

const h = (x: number, y: number): GridEdge => ({ orientation: 'h', x, y });
const v = (x: number, y: number): GridEdge => ({ orientation: 'v', x, y });

type LegacyCell = GridCell & { bin?: number };
type LegacyConfig = Omit<BinConfig, 'bins'> & {
  cells: LegacyCell[];
  splitMode?: 'auto' | 'manual';
  splitLines?: SplitLine[];
  baseSlopes?: (BinSlope & { bin: number })[];
};

function migrateFixture(config: LegacyConfig): BinConfig {
  const grouped = new Map<number, GridCell[]>();
  for (const { bin = 0, x, y } of config.cells) {
    grouped.set(bin, [...(grouped.get(bin) ?? []), { x, y }]);
  }
  const { cells: _cells, splitMode: _mode, splitLines = [], baseSlopes = [], ...global } = config;
  return {
    ...global,
    bins: [...grouped.entries()].sort(([a], [b]) => a - b).map(([id, cells]) => ({
      id, cells, isManual: true, splitLines,
      slope: baseSlopes.find((s) => s.bin === id),
    })),
  };
}

const base: Omit<LegacyConfig, 'cells'> = {
  heightUnits: 3, wallThickness: 1.2, cavityCornerRadius: 3.75, innerFilletRadius: 0.5,
  magnetHoles: true, screwHoles: false,
  openEdges: [], dividerEdges: [], innerWalls: [], splitMode: 'manual', splitLines: [],
  baseSlopes: [],
};

const cases: { name: string; config: LegacyConfig }[] = [
  { name: '1x1 default',         config: { ...base, cells: rect(1, 1) } },
  { name: '2x2 default',         config: { ...base, cells: rect(2, 2) } },
  { name: '3x2 default',         config: { ...base, cells: rect(3, 2) } },
  { name: 'L-shape',             config: { ...base, cells: L } },
  { name: 'T-shape',             config: { ...base, cells: T } },
  { name: 'staircase (corners)', config: { ...base, cells: staircase } },
  { name: 'disjoint cells',      config: { ...base, cells: disjoint } },
  { name: '1x1 h1 cavityR0',     config: { ...base, cells: rect(1, 1), heightUnits: 1, cavityCornerRadius: 0 } },
  { name: '1x1 h8 thickwall',    config: { ...base, cells: rect(1, 1), heightUnits: 8, wallThickness: 4 } },
  { name: 'thickwall + cavityR', config: { ...base, cells: rect(1, 1), wallThickness: 3.75, cavityCornerRadius: 3.75 } },
  { name: '2x2 magnet+screw',    config: { ...base, cells: rect(2, 2), magnetHoles: true, screwHoles: true } },
  { name: '2x2 no holes',        config: { ...base, cells: rect(2, 2), magnetHoles: false, screwHoles: false } },
  { name: '2x2 screw only',      config: { ...base, cells: rect(2, 2), magnetHoles: false, screwHoles: true } },
  { name: '3x3 cavityR6',        config: { ...base, cells: rect(3, 3), cavityCornerRadius: 6 } },
  { name: '2x2 fillet0',         config: { ...base, cells: rect(2, 2), innerFilletRadius: 0 } },
  { name: '2x2 fillet3',         config: { ...base, cells: rect(2, 2), innerFilletRadius: 3 } },
  { name: 'L-shape fillet2',     config: { ...base, cells: L, innerFilletRadius: 2 } },
  { name: 'L open fillet6',      config: { ...base, cells: L, innerFilletRadius: 6, openEdges: [v(1, 1)] } },
  { name: '1x1 h1 fillet3',      config: { ...base, cells: rect(1, 1), heightUnits: 1, innerFilletRadius: 3 } },
  { name: 'thickwall fillet3',   config: { ...base, cells: rect(1, 1), wallThickness: 4, innerFilletRadius: 3 } },
  { name: 'empty (unit cube)',   config: { ...base, cells: [] } },
  // Wall toggles
  { name: '1x1 one side open',   config: { ...base, cells: rect(1, 1), openEdges: [h(0, 0)] } },
  { name: '1x1 corner open',     config: { ...base, cells: rect(1, 1), openEdges: [h(0, 0), v(0, 0)] } },
  { name: '1x1 all sides open',  config: { ...base, cells: rect(1, 1), openEdges: [h(0, 0), h(0, 1), v(0, 0), v(1, 0)] } },
  { name: '1x1 all open rc20',   config: { ...base, cells: rect(1, 1), cavityCornerRadius: 20, openEdges: [h(0, 0), h(0, 1), v(0, 0), v(1, 0)] } },
  { name: 'L concave edge open', config: { ...base, cells: L, openEdges: [v(1, 1)] } },
  { name: '2x2 divider cross',   config: { ...base, cells: rect(2, 2), dividerEdges: [v(1, 0), v(1, 1), h(0, 1), h(1, 1)] } },
  { name: 'divider cross fillet', config: { ...base, cells: rect(2, 2), cavityCornerRadius: 0, innerFilletRadius: 3, dividerEdges: [v(1, 0), v(1, 1), h(0, 1), h(1, 1)] } },
  { name: 'divider T fillet',    config: { ...base, cells: rect(2, 2), cavityCornerRadius: 0, innerFilletRadius: 3, dividerEdges: [v(1, 0), v(1, 1), h(1, 1)] } },
  { name: '2x1 divider + open',  config: { ...base, cells: rect(2, 1), dividerEdges: [v(1, 0)], openEdges: [h(0, 0), h(1, 0)] } },
  // Cavity corner radius clamping / interactions
  { name: '1x1 rc20 (clamp)',    config: { ...base, cells: rect(1, 1), cavityCornerRadius: 20 } },
  { name: '3x3 rc20 + dividers', config: { ...base, cells: rect(3, 3), cavityCornerRadius: 20, dividerEdges: [v(1, 0), v(1, 1), v(1, 2)] } },
  { name: 'rc20 fillet10 thick', config: { ...base, cells: rect(2, 2), cavityCornerRadius: 20, innerFilletRadius: 10, wallThickness: 4 } },
  // Free-form inner walls
  { name: 'wall sharp base',     config: { ...base, cells: rect(2, 2), innerFilletRadius: 0, innerWalls: [{ x1: 6, y1: 42, x2: 78, y2: 42, width: 1.6, height: null }] } },
  { name: 'diag wall full',      config: { ...base, cells: rect(2, 2), innerWalls: [{ x1: 6, y1: 6, x2: 78, y2: 78, width: 1.6, height: null }] } },
  { name: 'low wall ramps',      config: { ...base, cells: rect(2, 2), innerWalls: [{ x1: 0, y1: 40, x2: 84, y2: 44, width: 2, height: 8 }] } },
  { name: 'low wall to open',    config: { ...base, cells: rect(1, 1), openEdges: [v(1, 0)], innerWalls: [{ x1: 0, y1: 21, x2: 42, y2: 21, width: 1.2, height: 6 }] } },
  { name: 'low wall x divider',  config: { ...base, cells: rect(3, 1), dividerEdges: [v(1, 0)], innerWalls: [{ x1: 4, y1: 10, x2: 122, y2: 32, width: 1.6, height: 7 }] } },
  { name: 'crossing wall hts',   config: { ...base, cells: rect(2, 2), innerWalls: [
      { x1: 0, y1: 21, x2: 84, y2: 21, width: 1.6, height: 6 },
      { x1: 43, y1: 0, x2: 41, y2: 84, width: 2, height: 14 },
    ] } },
  { name: 'crossing wall fillet', config: { ...base, cells: rect(2, 2), innerFilletRadius: 3, innerWalls: [
      { x1: 6, y1: 42, x2: 78, y2: 42, width: 1.6, height: null },
      { x1: 42, y1: 6, x2: 42, y2: 78, width: 1.6, height: null },
    ] } },
  { name: 'T wall fillet',       config: { ...base, cells: rect(2, 2), innerFilletRadius: 3, innerWalls: [
      { x1: 6, y1: 42, x2: 78, y2: 42, width: 1.6, height: null },
      { x1: 42, y1: 6, x2: 42, y2: 42, width: 1.6, height: null },
    ] } },
  { name: 'wall meets perimeter', config: { ...base, cells: rect(2, 1), innerFilletRadius: 3, innerWalls: [
      { x1: 0, y1: 21, x2: 70, y2: 21, width: 1.6, height: null },
    ] } },
  { name: 'unequal wall junction', config: { ...base, cells: rect(2, 2), innerFilletRadius: 6, innerWalls: [
      { x1: 6, y1: 42, x2: 78, y2: 42, width: 1.6, height: 3 },
      { x1: 42, y1: 6, x2: 42, y2: 78, width: 1.6, height: 12 },
    ] } },
  { name: 'nearby separate walls', config: { ...base, cells: rect(2, 1), innerFilletRadius: 3, innerWalls: [
      { x1: 6, y1: 19, x2: 78, y2: 19, width: 1.6, height: null },
      { x1: 6, y1: 23, x2: 78, y2: 23, width: 1.6, height: null },
    ] } },
  { name: 'junction at open edge', config: { ...base, cells: rect(2, 1), innerFilletRadius: 3, openEdges: [v(2, 0)], innerWalls: [
      { x1: 20, y1: 21, x2: 84, y2: 21, width: 1.6, height: null },
      { x1: 60, y1: 5, x2: 60, y2: 37, width: 1.6, height: null },
    ] } },
  { name: 'wall rc20 fillet6',   config: { ...base, cells: rect(2, 2), cavityCornerRadius: 20, innerFilletRadius: 6, innerWalls: [{ x1: 0, y1: 30, x2: 84, y2: 60, width: 1.6, height: 8 }] } },
  { name: 'wall in wall band',   config: { ...base, cells: rect(2, 2), innerWalls: [{ x1: 0, y1: 0.5, x2: 84, y2: 0.5, width: 1, height: null }] } },
  // Sloped base
  { name: 'slope 15 +y',         config: { ...base, cells: rect(2, 2), baseSlopes: [{ bin: 0, angle: 15, dir: '+y' }] } },
  { name: 'slope 30 -x fillet3', config: { ...base, cells: rect(1, 1), baseSlopes: [{ bin: 0, angle: 30, dir: '-x' }], innerFilletRadius: 3 } },
  { name: 'L slope 20 rc6',      config: { ...base, cells: L, baseSlopes: [{ bin: 0, angle: 20, dir: '+x' }], cavityCornerRadius: 6 } },
  { name: 'slope 45 h1 clamp',   config: { ...base, cells: rect(2, 1), heightUnits: 1, baseSlopes: [{ bin: 0, angle: 45, dir: '-y' }] } },
  { name: 'slope + low wall',    config: { ...base, cells: rect(2, 2), baseSlopes: [{ bin: 0, angle: 12, dir: '+x' }], innerWalls: [{ x1: 0, y1: 42, x2: 84, y2: 42, width: 1.6, height: 9 }] } },
  // Multiple distinct bins
  { name: '2 bins adjacent',     config: { ...base, cells: [
      { x: 0, y: 0, bin: 0 }, { x: 0, y: 1, bin: 0 },
      { x: 1, y: 0, bin: 1 }, { x: 1, y: 1, bin: 1 },
    ] } },
  { name: '2 bins 2 slopes',     config: { ...base, cells: [
      { x: 0, y: 0, bin: 0 }, { x: 0, y: 1, bin: 0 },
      { x: 1, y: 0, bin: 1 }, { x: 1, y: 1, bin: 1 },
    ], baseSlopes: [
      { bin: 0, angle: 18, dir: '+y' },
      { bin: 1, angle: 25, dir: '-x' },
    ] } },
  { name: '1x1 h20 tall',        config: { ...base, cells: rect(1, 1), heightUnits: 20, baseSlopes: [{ bin: 0, angle: 30, dir: '+x' }] } },
];

const U: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }];

// Split cases: every exported piece must independently pass all checks.
const splitCases: { name: string; config: LegacyConfig }[] = [
  { name: '6x1 split in 2',      config: { ...base, cells: rect(6, 1), splitLines: [{ axis: 'x', index: 3 }] } },
  { name: '4x2 divider on seam', config: { ...base, cells: rect(4, 2), splitLines: [{ axis: 'x', index: 2 }], dividerEdges: [v(2, 0), v(2, 1)] } },
  { name: 'L split (empty box)', config: { ...base, cells: L, splitLines: [{ axis: 'x', index: 1 }, { axis: 'y', index: 1 }] } },
  { name: 'U split (disjoint)',  config: { ...base, cells: U, splitLines: [{ axis: 'y', index: 1 }] } },
  { name: 'wall across seam',    config: { ...base, cells: rect(4, 1), splitLines: [{ axis: 'x', index: 2 }], innerWalls: [{ x1: 10, y1: 21, x2: 158, y2: 21, width: 1.6, height: 8 }] } },
  { name: 'wall junction on seam', config: { ...base, cells: rect(4, 2), innerFilletRadius: 3, splitLines: [{ axis: 'x', index: 2 }], innerWalls: [
      { x1: 10, y1: 42, x2: 158, y2: 42, width: 1.6, height: 10 },
      { x1: 84, y1: 5, x2: 84, y2: 79, width: 1.6, height: 10 },
    ] } },
  { name: 'slope across seam',   config: { ...base, cells: rect(6, 1), baseSlopes: [{ bin: 0, angle: 8, dir: '-x' }], splitLines: [{ axis: 'x', index: 3 }] } },
  { name: '2 bins + split',      config: { ...base, cells: [
      { x: 0, y: 0, bin: 0 }, { x: 1, y: 0, bin: 0 }, { x: 2, y: 0, bin: 1 }, { x: 3, y: 0, bin: 1 },
    ], splitLines: [{ axis: 'x', index: 1 }] } },
];

(async () => {
  const wasm = await initManifold();
  let anyBad = false;

  const check = (name: string, mesh: BinMesh): void => {
    const r = analyzeIndexed(mesh);
    const stl = stlBoundary(meshToStl(mesh.vertProperties, mesh.triVerts));
    const bad = r.boundaryEdges || r.nonManifoldEdges || r.orientationErrors || r.degenerate || r.duplicateFaces || r.membranes || stl.boundary || stl.nonManifold;
    if (bad) anyBad = true;
    console.log(
      `${name.padEnd(28)} tris=${String(r.triangles).padStart(6)} ` +
      `boundary=${r.boundaryEdges} nonManifold=${r.nonManifoldEdges} orient=${r.orientationErrors} ` +
      `degen=${r.degenerate} dupFace=${r.duplicateFaces} membrane=${r.membranes} | stl(bnd=${stl.boundary},nm=${stl.nonManifold})` +
      (bad ? '  ✗ DEFECTIVE' : '  ✓ clean'),
    );
  };

  for (const { name, config } of cases) {
    try {
      check(name, generateBinManifold(wasm, migrateFixture(config)));
    } catch (err) {
      anyBad = true;
      console.log(`${name.padEnd(28)} ERROR: ${String(err)}`);
    }
  }

  for (const { name, config } of splitCases) {
    try {
      const { pieces } = generateBinPieces(wasm, migrateFixture(config));
      for (const piece of pieces) {
        check(`${name} [${piece.name.replace('gridfinity-bin-', '').replace('.stl', '')}]`, piece.mesh);
      }
    } catch (err) {
      anyBad = true;
      console.log(`${name.padEnd(28)} ERROR: ${String(err)}`);
    }
  }

  const semanticCases: { name: string; config: LegacyConfig; probes: { point: [number, number, number]; solid: boolean }[] }[] = [
    {
      name: 'fillet minimum corner',
      config: { ...base, cells: rect(1, 1), cavityCornerRadius: 0, innerFilletRadius: 3 },
      probes: [
        { point: [2, 2, 12], solid: true },
        { point: [3, 3, 12], solid: false },
      ],
    },
    {
      name: 'divider cross junction',
      config: { ...base, cells: rect(2, 2), cavityCornerRadius: 0, innerFilletRadius: 3, dividerEdges: [v(1, 0), v(1, 1), h(0, 1), h(1, 1)] },
      probes: [
        { point: [41, 41, 12], solid: true },
        { point: [40, 40, 12], solid: false },
      ],
    },
    {
      name: 'divider fillet envelope',
      config: { ...base, cells: rect(2, 1), innerFilletRadius: 3, dividerEdges: [v(1, 0)] },
      probes: [
        { point: [42, 20.37, 8.47], solid: true },
        { point: [40, 20.37, 8.47], solid: true },
        { point: [40, 20.37, 11.47], solid: false },
      ],
    },
    {
      name: 'disjoint fillet envelope',
      config: { ...base, cells: disjoint, innerFilletRadius: 3 },
      probes: [{ point: [63, 20.37, 8.47], solid: false }],
    },
    {
      name: 'non-convex fillet envelope',
      config: { ...base, cells: L, innerFilletRadius: 3 },
      probes: [{ point: [63, 62.37, 8.47], solid: false }],
    },
    {
      name: 'crossing wall fillets',
      config: { ...base, cells: rect(2, 2), innerFilletRadius: 3, innerWalls: [
        { x1: 5, y1: 21, x2: 79, y2: 21, width: 1.6, height: 12 },
        { x1: 42, y1: 5, x2: 42, y2: 79, width: 1.6, height: 12 },
      ] },
      probes: [
        { point: [42, 21.37, 8.47], solid: true },
        { point: [30, 23.37, 8.47], solid: true },
        { point: [30, 23.37, 11.47], solid: false },
        { point: [41, 20, 12], solid: true },
      ],
    },
    {
      name: 'T wall junction',
      config: { ...base, cells: rect(2, 2), innerFilletRadius: 3, innerWalls: [
        { x1: 6, y1: 42, x2: 78, y2: 42, width: 1.6, height: 12 },
        { x1: 42, y1: 6, x2: 42, y2: 42, width: 1.6, height: 12 },
      ] },
      probes: [
        { point: [41, 41, 12], solid: true },
        { point: [39, 39, 12], solid: false },
      ],
    },
    {
      name: 'wall perimeter junction',
      config: { ...base, cells: rect(2, 1), innerFilletRadius: 3, innerWalls: [
        { x1: 0, y1: 21, x2: 70, y2: 21, width: 1.6, height: 12 },
      ] },
      probes: [
        { point: [1.8, 19.8, 12], solid: true },
        { point: [4, 17, 12], solid: false },
      ],
    },
    {
      name: 'unequal junction cap',
      config: { ...base, cells: rect(2, 2), innerFilletRadius: 6, innerWalls: [
        { x1: 6, y1: 42, x2: 78, y2: 42, width: 1.6, height: 3 },
        { x1: 42, y1: 6, x2: 42, y2: 78, width: 1.6, height: 12 },
      ] },
      probes: [
        { point: [41, 41, 10], solid: true },
        { point: [41, 41, 16], solid: false },
      ],
    },
    {
      name: 'disconnected wall gap',
      config: { ...base, cells: rect(2, 1), innerFilletRadius: 3, innerWalls: [
        { x1: 6, y1: 19, x2: 78, y2: 19, width: 1.6, height: 12 },
        { x1: 6, y1: 23, x2: 78, y2: 23, width: 1.6, height: 12 },
      ] },
      probes: [{ point: [42, 21, 12], solid: false }],
    },
    {
      name: 'sharp wall base',
      config: { ...base, cells: rect(2, 1), innerFilletRadius: 0, innerWalls: [
        { x1: 5, y1: 21, x2: 79, y2: 21, width: 1.6, height: 12 },
      ] },
      probes: [{ point: [30, 23.37, 8.47], solid: false }],
    },
  ];

  for (const { name, config, probes } of semanticCases) {
    try {
      const mesh = generateBinManifold(wasm, migrateFixture(config));
      const failed = probes.filter(({ point, solid }) => containsPoint(mesh, point) !== solid);
      if (failed.length) anyBad = true;
      console.log(`${name.padEnd(28)} semantic=${failed.length ? 'FAIL' : 'pass'}`);
    } catch (err) {
      anyBad = true;
      console.log(`${name.padEnd(28)} ERROR: ${String(err)}`);
    }
  }

  console.log(anyBad
    ? '\nRESULT: FAIL — defective output detected.'
    : '\nRESULT: PASS — all cases watertight, manifold & membrane-free.');
  process.exit(anyBad ? 1 : 0);
})();

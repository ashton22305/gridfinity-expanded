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
import { generateBinManifold } from '../src/lib/geometry/gridfinity';
import { initManifold, type BinMesh } from '../src/lib/geometry/manifold';
import { meshToStl } from '../src/lib/export/stl';
import type { BinConfig, GridCell } from '../src/lib/types';

interface Report {
  triangles: number;
  degenerate: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  orientationErrors: number;
  duplicateFaces: number;
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

  return { triangles: tv.length / 3, degenerate, boundaryEdges, nonManifoldEdges, orientationErrors, duplicateFaces };
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

const rect = (w: number, h: number): GridCell[] => {
  const c: GridCell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.push({ x, y });
  return c;
};
const L: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }];
const T: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }];
const staircase: GridCell[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }];  // corner-touching only
const disjoint: GridCell[] = [{ x: 0, y: 0 }, { x: 2, y: 0 }];                   // separated cells

const base: Omit<BinConfig, 'cells'> = {
  heightUnits: 3, wallThickness: 1.2, cornerRadius: 3.75, magnetHoles: true, screwHoles: false,
};

const cases: { name: string; config: BinConfig }[] = [
  { name: '1x1 default',         config: { ...base, cells: rect(1, 1) } },
  { name: '2x2 default',         config: { ...base, cells: rect(2, 2) } },
  { name: '3x2 default',         config: { ...base, cells: rect(3, 2) } },
  { name: 'L-shape',             config: { ...base, cells: L } },
  { name: 'T-shape',             config: { ...base, cells: T } },
  { name: 'staircase (corners)', config: { ...base, cells: staircase } },
  { name: 'disjoint cells',      config: { ...base, cells: disjoint } },
  { name: '1x1 h1 cornerR0',     config: { ...base, cells: rect(1, 1), heightUnits: 1, cornerRadius: 0 } },
  { name: '1x1 h8 thickwall',    config: { ...base, cells: rect(1, 1), heightUnits: 8, wallThickness: 4 } },
  { name: 'thickwall == corner', config: { ...base, cells: rect(1, 1), wallThickness: 3.75, cornerRadius: 3.75 } },
  { name: '2x2 magnet+screw',    config: { ...base, cells: rect(2, 2), magnetHoles: true, screwHoles: true } },
  { name: '2x2 no holes',        config: { ...base, cells: rect(2, 2), magnetHoles: false, screwHoles: false } },
  { name: '2x2 screw only',      config: { ...base, cells: rect(2, 2), magnetHoles: false, screwHoles: true } },
  { name: '3x3 cornerR6',        config: { ...base, cells: rect(3, 3), cornerRadius: 6 } },
  { name: 'empty (unit cube)',   config: { ...base, cells: [] } },
];

(async () => {
  const wasm = await initManifold();
  let anyBad = false;

  for (const { name, config } of cases) {
    try {
      const mesh = generateBinManifold(wasm, config);
      const r = analyzeIndexed(mesh);
      const stl = stlBoundary(meshToStl(mesh.vertProperties, mesh.triVerts));
      const bad = r.boundaryEdges || r.nonManifoldEdges || r.orientationErrors || r.degenerate || r.duplicateFaces || stl.boundary || stl.nonManifold;
      if (bad) anyBad = true;
      console.log(
        `${name.padEnd(22)} tris=${String(r.triangles).padStart(6)} ` +
        `boundary=${r.boundaryEdges} nonManifold=${r.nonManifoldEdges} orient=${r.orientationErrors} ` +
        `degen=${r.degenerate} dupFace=${r.duplicateFaces} | stl(bnd=${stl.boundary},nm=${stl.nonManifold})` +
        (bad ? '  ✗ NON-MANIFOLD' : '  ✓ manifold'),
      );
    } catch (err) {
      anyBad = true;
      console.log(`${name.padEnd(22)} ERROR: ${String(err)}`);
    }
  }

  console.log(anyBad
    ? '\nRESULT: FAIL — non-manifold output detected.'
    : '\nRESULT: PASS — all cases watertight & manifold.');
  process.exit(anyBad ? 1 : 0);
})();

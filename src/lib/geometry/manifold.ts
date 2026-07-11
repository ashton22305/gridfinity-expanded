// Manifold engine initialization and output mesh repair boundary.
import Module from 'manifold-3d';
import type { ManifoldToplevel, Manifold } from 'manifold-3d';

export interface BinMesh {
  vertProperties: Float32Array;  // flat xyz, 3 per vertex
  triVerts: Uint32Array;         // 3 vertex indices per triangle
}

let cached: Promise<ManifoldToplevel> | null = null;

/**
 * Loads and memoizes the WASM module. `locateWasm` supplies the `.wasm` URL and
 * is required in a bundler/browser context (pass a Vite `?url` import); omit it
 * in Node, where Emscripten finds the file next to the module automatically.
 */
export function initManifold(locateWasm?: () => string): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = Module(locateWasm ? { locateFile: locateWasm } : undefined).then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return cached;
}

// Snap grid for the output weld: 1e-3 mm (1 micron). Coarser than the
// sub-micron near-coincidences a robust boolean leaves where differently-faceted
// surfaces meet, yet 10x finer than the smallest intended feature — so it fuses
// only artifacts, never distinct geometry.
const OUT_WELD = 1e3;

/**
 * Extracts the triangle mesh from a finished `Manifold` and welds
 * exactly-coincident vertices.
 *
 * Tiny CSG overlaps can leave manifold emitting a handful of duplicated
 * vertices (zero-length edges) and the
 * zero-area triangles spanning them. Merging those duplicates and dropping the
 * collapsed triangles removes the slivers while preserving the closed manifold —
 * so no slicer flags a degenerate facet or a vertex-welded non-manifold edge.
 */
export function manifoldMesh(manifold: Manifold): BinMesh {
  const mesh = manifold.getMesh();
  const src = mesh.vertProperties;
  const srcTris = mesh.triVerts;

  const remap = new Uint32Array(src.length / 3);
  const index = new Map<string, number>();
  const out: number[] = [];
  for (let v = 0; v < src.length / 3; v++) {
    const x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
    const key = `${Math.round(x * OUT_WELD)},${Math.round(y * OUT_WELD)},${Math.round(z * OUT_WELD)}`;
    let id = index.get(key);
    if (id === undefined) { id = out.length / 3; index.set(key, id); out.push(x, y, z); }
    remap[v] = id;
  }

  let tris: number[] = [];
  for (let i = 0; i < srcTris.length; i += 3) {
    const a = remap[srcTris[i]], b = remap[srcTris[i + 1]], c = remap[srcTris[i + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);  // drop collapsed triangles
  }
  tris = repairDegenerateTris(out, tris);

  return { vertProperties: new Float32Array(out), triVerts: new Uint32Array(tris) };
}

/**
 * Removes zero-area triangles whose three vertices are distinct but collinear.
 * These appear when float32 quantization flattens a sub-micron sliver the
 * boolean left along an intersection edge: the double-precision mesh was
 * valid, but the quantized copy has an exactly-degenerate facet.
 *
 * Simply dropping such a triangle would open a hole. Instead the neighbor
 * across the sliver's longest edge (u→v, with m the middle vertex) is split
 * at m: (v,u,x) becomes (v,m,x) + (m,u,x). Every directed edge stays paired,
 * so the mesh remains closed and 2-manifold.
 */
function repairDegenerateTris(vp: number[], tris: number[]): number[] {
  const area = (a: number, b: number, c: number): number => {
    const ux = vp[b*3]-vp[a*3], uy = vp[b*3+1]-vp[a*3+1], uz = vp[b*3+2]-vp[a*3+2];
    const vx = vp[c*3]-vp[a*3], vy = vp[c*3+1]-vp[a*3+1], vz = vp[c*3+2]-vp[a*3+2];
    const cx = uy*vz-uz*vy, cy = uz*vx-ux*vz, cz = ux*vy-uy*vx;
    return Math.hypot(cx, cy, cz) / 2;
  };
  const len2 = (a: number, b: number): number => {
    const dx = vp[b*3]-vp[a*3], dy = vp[b*3+1]-vp[a*3+1], dz = vp[b*3+2]-vp[a*3+2];
    return dx*dx + dy*dy + dz*dz;
  };

  for (let iter = 0; iter < 8; iter++) {
    const edgeOwner = new Map<string, number>();
    for (let t = 0; t < tris.length / 3; t++) {
      for (let e = 0; e < 3; e++) {
        edgeOwner.set(`${tris[t*3+e]}>${tris[t*3+(e+1)%3]}`, t);
      }
    }

    const dead = new Set<number>();
    let changed = false;
    const triCount = tris.length / 3;
    for (let t = 0; t < triCount; t++) {
      if (dead.has(t)) continue;
      const verts = [tris[t*3], tris[t*3+1], tris[t*3+2]];
      if (area(verts[0], verts[1], verts[2]) >= 1e-9) continue;
      // Longest edge u→v (as directed in this triangle); m is the middle vertex.
      let best = 0, bestLen = -1;
      for (let e = 0; e < 3; e++) {
        const l = len2(verts[e], verts[(e+1)%3]);
        if (l > bestLen) { bestLen = l; best = e; }
      }
      const u = verts[best], v = verts[(best+1)%3], m = verts[(best+2)%3];
      const n = edgeOwner.get(`${v}>${u}`);
      if (n === undefined || n === t || dead.has(n)) continue;
      const nv = [tris[n*3], tris[n*3+1], tris[n*3+2]];
      const k = nv.findIndex((val, i2) => val === v && nv[(i2+1)%3] === u);
      if (k < 0) continue;
      const x = nv[(k+2)%3];
      if (x === m) continue;
      // n is rewritten in place to (v,m,x); the second half is appended. Stale
      // edge-map hits on n are harmless: the findIndex above re-verifies
      // against the current triangle before any rewrite.
      tris[n*3] = v; tris[n*3+1] = m; tris[n*3+2] = x;
      tris.push(m, u, x);
      dead.add(t);
      changed = true;
    }

    if (dead.size) {
      const next: number[] = [];
      for (let t = 0; t < tris.length / 3; t++) {
        if (!dead.has(t)) next.push(tris[t*3], tris[t*3+1], tris[t*3+2]);
      }
      tris = next;
    }
    if (!changed) break;
  }
  return tris;
}

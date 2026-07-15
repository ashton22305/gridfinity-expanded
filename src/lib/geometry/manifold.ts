import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';

let cached: Promise<ManifoldToplevel> | null = null;

/** Initialize the Manifold WASM engine once per runtime. */
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
 * Quantize Manifold's native indexed output to serialized float32 precision,
 * then expand it into independent triangles.
 *
 * Exact booleans can rebuild a feature twice within one float32 ULP, so a mesh
 * that is valid in WASM's float64 coordinates can gain collapsed or collinear
 * zero-area triangles once written as float32. Welding on a 1-micron grid and
 * repairing the collapsed facets keeps the emitted soup closed and 2-manifold
 * at exactly the precision every consumer receives.
 */
export function manifoldTriangles(manifold: Manifold): Float32Array {
  const mesh = manifold.getMesh();

  const remap = new Uint32Array(mesh.vertProperties.length / 3);
  const index = new Map<string, number>();
  const welded: number[] = [];
  for (let vertex = 0; vertex < mesh.vertProperties.length / 3; vertex++) {
    const x = mesh.vertProperties[vertex * mesh.numProp];
    const y = mesh.vertProperties[vertex * mesh.numProp + 1];
    const z = mesh.vertProperties[vertex * mesh.numProp + 2];
    const key = `${Math.round(x * OUT_WELD)},${Math.round(y * OUT_WELD)},${Math.round(z * OUT_WELD)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = welded.length / 3;
      index.set(key, id);
      welded.push(
        Math.fround(Math.round(x * OUT_WELD) / OUT_WELD),
        Math.fround(Math.round(y * OUT_WELD) / OUT_WELD),
        Math.fround(Math.round(z * OUT_WELD) / OUT_WELD),
      );
    }
    remap[vertex] = id;
  }

  let tris: number[] = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    const a = remap[mesh.triVerts[i]];
    const b = remap[mesh.triVerts[i + 1]];
    const c = remap[mesh.triVerts[i + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  tris = repairDegenerateTris(welded, tris);

  const triangles = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    triangles[i * 3] = welded[tris[i] * 3];
    triangles[i * 3 + 1] = welded[tris[i] * 3 + 1];
    triangles[i * 3 + 2] = welded[tris[i] * 3 + 2];
  }
  return triangles;
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

  // Each rewrite changes edge adjacency, so rebuild the map after every repair
  // instead of applying later rewrites against stale topology.
  for (let iter = 0; iter < 256; iter++) {
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
      break;
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

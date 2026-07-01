// Manifold engine bridge.
//
// The generator authors solids and 2D profiles with @jscad/modeling, but hands
// every boolean and inward offset to manifold-3d (a Clipper2 + robust-CSG WASM
// library) so the exported mesh is guaranteed watertight and 2-manifold. This
// module is the seam between the two: WASM init plus JSCAD → manifold adapters.
import Module from 'manifold-3d';
import type { ManifoldToplevel, Manifold, CrossSection } from 'manifold-3d';
import { geometries } from '@jscad/modeling';

type Geom3 = Parameters<typeof geometries.geom3.toPolygons>[0];
type Geom2 = Parameters<typeof geometries.geom2.toOutlines>[0];

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

// Weld tolerance for indexing: 1e-5 mm. JSCAD emits per-face vertex copies, so
// coincident positions must be fused into shared indices for the mesh to import
// as a manifold. Each primitive fed here is an individually closed solid.
const WELD = 1e5;

/** Adapts a JSCAD solid (any closed primitive) into a manifold `Manifold`. */
export function geom3ToManifold(wasm: ManifoldToplevel, geom: Geom3): Manifold {
  const polygons = geometries.geom3.toPolygons(geom);
  const index = new Map<string, number>();
  const vertProperties: number[] = [];
  const triVerts: number[] = [];

  const idOf = (p: readonly number[]): number => {
    const key = `${Math.round(p[0] * WELD)},${Math.round(p[1] * WELD)},${Math.round(p[2] * WELD)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = vertProperties.length / 3;
      index.set(key, id);
      vertProperties.push(p[0], p[1], p[2]);
    }
    return id;
  };

  for (const poly of polygons) {
    const ring = poly.vertices.map(idOf);
    for (let i = 1; i < ring.length - 1; i++) triVerts.push(ring[0], ring[i], ring[i + 1]);  // fan
  }

  return new wasm.Manifold(new wasm.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertProperties),
    triVerts: new Uint32Array(triVerts),
  }));
}

/** Adapts a JSCAD 2D profile (outer contour plus any holes) into a `CrossSection`. */
export function geom2ToCrossSection(wasm: ManifoldToplevel, geom: Geom2): CrossSection {
  const outlines = geometries.geom2.toOutlines(geom);
  return new wasm.CrossSection(outlines.map((loop) => loop.map((p) => [p[0], p[1]] as [number, number])));
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
 * The tiny CSG overlaps that make the JSCAD-authored solids fuse cleanly leave
 * manifold emitting a handful of duplicated vertices (zero-length edges) and the
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

  const tris: number[] = [];
  for (let i = 0; i < srcTris.length; i += 3) {
    const a = remap[srcTris[i]], b = remap[srcTris[i + 1]], c = remap[srcTris[i + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);  // drop collapsed triangles
  }

  return { vertProperties: new Float32Array(out), triVerts: new Uint32Array(tris) };
}

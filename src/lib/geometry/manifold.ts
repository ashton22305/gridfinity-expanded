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

/** Expand Manifold's native indexed mesh directly into independent triangles. */
export function manifoldTriangles(manifold: Manifold): Float32Array {
  const mesh = manifold.getMesh();
  const triangles = new Float32Array(mesh.triVerts.length * 3);
  for (let index = 0; index < mesh.triVerts.length; index++) {
    const source = mesh.triVerts[index] * mesh.numProp;
    const target = index * 3;
    triangles[target] = mesh.vertProperties[source];
    triangles[target + 1] = mesh.vertProperties[source + 1];
    triangles[target + 2] = mesh.vertProperties[source + 2];
  }
  return triangles;
}

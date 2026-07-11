/** The minimum structural contract required to serialize a printable indexed mesh. */
export interface IndexedMeshLike {
  vertProperties: ArrayLike<number>;
  triVerts: ArrayLike<number>;
}

/**
 * Returns a concise reason when an indexed mesh cannot be safely serialized as
 * an STL. Topological validation remains the responsibility of the Manifold
 * path and `check:manifold`; this guard protects the worker export boundary.
 */
export function indexedMeshValidationError(mesh: IndexedMeshLike): string | null {
  const { vertProperties, triVerts } = mesh;
  if (vertProperties.length === 0 || triVerts.length === 0) {
    return 'mesh has no vertices or triangles';
  }
  if (vertProperties.length % 3 !== 0) return 'vertex properties are not xyz triples';
  if (triVerts.length % 3 !== 0) return 'triangle indices are not triples';

  const vertexCount = vertProperties.length / 3;
  if (vertexCount < 3) return 'mesh has fewer than three vertices';

  for (let i = 0; i < vertProperties.length; i++) {
    if (!Number.isFinite(vertProperties[i])) return `vertex property ${i} is not finite`;
  }
  for (let i = 0; i < triVerts.length; i++) {
    const index = triVerts[i];
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      return `triangle index ${i} is outside the vertex array`;
    }
  }
  for (let i = 0; i < triVerts.length; i += 3) {
    const a = triVerts[i];
    const b = triVerts[i + 1];
    const c = triVerts[i + 2];
    if (a === b || b === c || a === c) return `triangle ${i / 3} repeats a vertex`;

    const ax = vertProperties[a * 3];
    const ay = vertProperties[a * 3 + 1];
    const az = vertProperties[a * 3 + 2];
    const bx = vertProperties[b * 3];
    const by = vertProperties[b * 3 + 1];
    const bz = vertProperties[b * 3 + 2];
    const cx = vertProperties[c * 3];
    const cy = vertProperties[c * 3 + 1];
    const cz = vertProperties[c * 3 + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area < 1e-9) return `triangle ${i / 3} has zero area`;
  }
  return null;
}

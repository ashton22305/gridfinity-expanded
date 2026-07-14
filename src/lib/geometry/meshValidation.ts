import type { TriangleMesh } from '../types';

/** Lightweight structural check; topology remains the manifold gate's job. */
export function indexedMeshValidationError(mesh: TriangleMesh): string | null {
  const { positions, indices } = mesh;
  if (positions.length === 0 || indices.length === 0) return 'mesh has no vertices or triangles';
  if (positions.length % 3 !== 0) return 'positions are not xyz triples';
  if (indices.length % 3 !== 0) return 'triangle indices are not triples';
  const vertexCount = positions.length / 3;
  if (vertexCount < 3) return 'mesh has fewer than three vertices';
  for (let index = 0; index < positions.length; index++) {
    if (!Number.isFinite(positions[index])) return `position ${index} is not finite`;
  }
  for (let index = 0; index < indices.length; index++) {
    const vertex = indices[index];
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      return `triangle index ${index} is outside the vertex array`;
    }
  }
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    if (a === b || b === c || a === c) return `triangle ${index / 3} repeats a vertex`;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const area = Math.hypot(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    ) / 2;
    if (area < 1e-9) return `triangle ${index / 3} has zero area`;
  }
  return null;
}

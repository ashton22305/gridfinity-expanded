export function downloadBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadStl(buffer: ArrayBuffer, filename = 'gridfinity-bin.stl'): void {
  downloadBuffer(buffer, filename, 'model/stl');
}

/**
 * Serializes an indexed triangle mesh (as produced by the manifold engine) to
 * binary STL. Per-facet normals are computed from the winding so the file is
 * self-describing for slicers.
 */
export function meshToStl(vertProperties: Float32Array, triVerts: Uint32Array): ArrayBuffer {
  const triCount = triVerts.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let i = 0; i < triVerts.length; i += 3) {
    const a = triVerts[i] * 3, b = triVerts[i + 1] * 3, c = triVerts[i + 2] * 3;
    const ax = vertProperties[a], ay = vertProperties[a + 1], az = vertProperties[a + 2];
    const bx = vertProperties[b], by = vertProperties[b + 1], bz = vertProperties[b + 2];
    const cx = vertProperties[c], cy = vertProperties[c + 1], cz = vertProperties[c + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true);      view.setFloat32(offset + 4, ny, true);  view.setFloat32(offset + 8, nz, true);
    view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
    offset += 48;
    view.setUint16(offset, 0, true);  // attribute byte count
    offset += 2;
  }
  return buffer;
}

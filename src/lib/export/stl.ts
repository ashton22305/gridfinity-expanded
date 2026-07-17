export function downloadBuffer(buffer: ArrayBuffer, filename: string, mimeType: string): void {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Serialize the exact generated triangle soup to binary STL. */
export function trianglesToStl(triangles: Float32Array): ArrayBuffer {
  const triangleCount = triangles.length / 9;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let index = 0; index < triangles.length; index += 9) {
    const ax = triangles[index], ay = triangles[index + 1], az = triangles[index + 2];
    const bx = triangles[index + 3], by = triangles[index + 4], bz = triangles[index + 5];
    const cx = triangles[index + 6], cy = triangles[index + 7], cz = triangles[index + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    nx /= length;
    ny /= length;
    nz /= length;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    for (let vertex = 0; vertex < 9; vertex++) {
      view.setFloat32(offset + 12 + vertex * 4, triangles[index + vertex], true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return buffer;
}

export function downloadStl(
  triangles: Float32Array,
  filename = 'gridfinity-bin.stl',
): void {
  downloadBuffer(trianglesToStl(triangles), filename, 'model/stl');
}

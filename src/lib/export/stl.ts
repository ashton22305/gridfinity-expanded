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

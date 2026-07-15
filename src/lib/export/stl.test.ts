import { describe, expect, it } from 'vitest';
import { partFilename, trianglesToStl } from './stl';

describe('STL export ownership', () => {
  it('derives filenames from stable bin ids and part indices', () => {
    expect(partFilename('bin-1', 1, 0, 1)).toBe('gridfinity-bin.stl');
    expect(partFilename('bin-2', 3, 2, 4)).toBe('gridfinity-bin-2-part-3-of-4.stl');
  });

  it('serializes triangle soup without indexing or coordinate transforms', () => {
    const triangles = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]);
    const buffer = trianglesToStl(triangles);
    const view = new DataView(buffer);

    expect(view.getUint32(80, true)).toBe(1);
    expect(view.getFloat32(96, true)).toBe(0);
    expect(view.getFloat32(108, true)).toBe(2);
    expect(view.getFloat32(124, true)).toBe(3);
  });
});

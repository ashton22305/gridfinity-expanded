import { describe, expect, it } from 'vitest';
import { partFilename, toPrintableObjects } from './printableObjects';
import { trianglesToStl } from './stl';

describe('STL export ownership', () => {
  it('derives filenames from stable bin ids and part indices', () => {
    expect(partFilename('bin-1', 1, 0, 1)).toBe('gridfinity-bin.stl');
    expect(partFilename('bin-2', 3, 2, 4)).toBe('gridfinity-bin-2-part-3-of-4.stl');
  });

  it('splits grouped bin pieces into distinct named printable objects', () => {
    const triangles = new Float32Array(9);
    const printables = toPrintableObjects([
      { binId: 'bin-1', pieces: [{ triangles, cells: [{ x: 0, y: 0 }] }] },
      { binId: 'bin-2', pieces: [
        { triangles, cells: [{ x: 2, y: 0 }] },
        { triangles, cells: [{ x: 3, y: 0 }] },
      ] },
    ]);
    expect(printables.map((printable) => printable.name)).toEqual([
      'gridfinity-bin-1.stl',
      'gridfinity-bin-2-part-1-of-2.stl',
      'gridfinity-bin-2-part-2-of-2.stl',
    ]);
    expect(printables[0].triangles).toBe(triangles);
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

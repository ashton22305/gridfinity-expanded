import { describe, expect, it } from 'vitest';
import { buildGeometryInput } from './geometryInput';
import type { Design } from './types';

const design: Design = {
  bins: [{
    id: 'editor-only-id',
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    openings: [],
    walls: [],
    cuts: [{ start: { x: 1, y: 0 }, end: { x: 1, y: 1 } }],
  }],
  heightUnits: 3,
  perimeterThickness: 1.2,
  filletRadius: 2.8,
  fasteners: { magnets: false, m3: false },
  printer: { name: 'Editor only', bedWidth: 100, bedDepth: 100 },
};

describe('trusted geometry input', () => {
  it('derives part groups, height, and preview offsets before the worker boundary', () => {
    const input = buildGeometryInput(design);

    expect(input.height).toBe(21);
    expect(input.bins[0].parts).toEqual([
      [{ x: 0, y: 0 }],
      [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    ]);
    expect(input.bins[0].previewOffsets).toEqual([
      { x: -0.15, y: 0 },
      { x: 0.15, y: 0 },
    ]);
    expect(input).not.toHaveProperty('printer');
    expect(input.bins[0]).not.toHaveProperty('cuts');
    expect(input.bins[0]).not.toHaveProperty('id');
  });
});

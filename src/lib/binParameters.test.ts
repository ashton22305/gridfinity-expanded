import { describe, expect, it } from 'vitest';
import { buildBinParameters } from './binParameters';
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

describe('bin parameters', () => {
  it('derives self-contained per-bin parameters with piece footprints', () => {
    const parameters = buildBinParameters(design);

    expect(parameters).toHaveLength(1);
    expect(parameters[0].height).toBe(21);
    expect(parameters[0].pieces).toEqual([
      [{ x: 0, y: 0 }],
      [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    ]);
    expect(parameters[0]).not.toHaveProperty('printer');
    expect(parameters[0]).not.toHaveProperty('cuts');
    expect(parameters[0]).not.toHaveProperty('previewOffsets');
  });

  it('forwards the stable bin id for piece identity', () => {
    expect(buildBinParameters(design)[0].binId).toBe('editor-only-id');
  });
});

import { describe, expect, it } from 'vitest';
import { validateDesign } from './validation';
import type { Design } from './types';

const design: Design = {
  bins: [{
    id: 'bin-1',
    cells: [{ x: 0, y: 0 }],
    openings: [],
    walls: [],
    cuts: [],
  }],
  heightUnits: 3,
  perimeterThickness: 1.2,
  filletRadius: 2.8,
  fasteners: { magnets: false, m3: false },
  printer: { name: 'Editor only', bedWidth: 100, bedDepth: 100 },
};

describe('frontend design validation', () => {
  it('clamps the fillet radius so the cavity keeps a straight wall', () => {
    const shallow = { ...design, heightUnits: 2, filletRadius: 8 };
    expect(validateDesign(shallow).filletRadius).toBeCloseTo(5.6);
    expect(validateDesign(design).filletRadius).toBe(2.8);
  });
});

import { describe, expect, it } from 'vitest';
import { buildBinParameters } from './binParameters';
import { maximumOccupiedRow } from './coordinates';
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

  it('uses a finite row-zero extent for a design without occupied cells', () => {
    expect(maximumOccupiedRow({ ...design, bins: [] })).toBe(0);
  });

  it('mirrors every spatial parameter across the shared occupied design height', () => {
    const asymmetric: Design = {
      ...design,
      bins: [
        {
          id: 'upper-cut-bin',
          cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
          openings: [
            { orientation: 'h', x: 0, y: 0 },
            { orientation: 'v', x: 0, y: 1 },
          ],
          walls: [{
            start: { x: 6, y: 47 },
            end: { x: 79, y: 79 },
            width: 1.6,
          }],
          cuts: [{ start: { x: 0, y: 1 }, end: { x: 1, y: 1 } }],
        },
        {
          id: 'lower-bin',
          cells: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
          openings: [{ orientation: 'h', x: 3, y: 5 }],
          walls: [],
          cuts: [],
        },
      ],
    };

    const parameters = buildBinParameters(asymmetric);

    expect(parameters[0].cells).toEqual([
      { x: 0, y: 4 }, { x: 0, y: 3 }, { x: 1, y: 3 },
    ]);
    expect(parameters[1].cells).toEqual([{ x: 3, y: 0 }, { x: 4, y: 0 }]);
    expect(parameters[0].openings).toEqual([
      { orientation: 'h', x: 0, y: 5 },
      { orientation: 'v', x: 0, y: 3 },
    ]);
    expect(parameters[1].openings).toEqual([
      { orientation: 'h', x: 3, y: 0 },
    ]);
    expect(parameters[0].walls).toEqual([{
      start: { x: 6, y: 163 },
      end: { x: 79, y: 131 },
      width: 1.6,
    }]);
    expect(parameters[0].pieces).toEqual([
      [{ x: 0, y: 4 }],
      [{ x: 0, y: 3 }, { x: 1, y: 3 }],
    ]);
  });
});

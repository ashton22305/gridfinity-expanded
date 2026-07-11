import { describe, expect, it } from 'vitest';
import type { GridCell, PrinterProfile } from './types';
import { checkBedFit, checkPieceFit, computeAutoSplitLines } from './printers';

const prusaMk4: PrinterProfile = {
  name: 'Prusa MK4 / MK3S+',
  bedWidth: 250,
  bedDepth: 210,
};

function rectangle(
  width: number,
  depth: number,
  offsetX = 0,
  offsetY = 0,
  bin?: number,
): GridCell[] {
  return Array.from({ length: depth }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      x: x + offsetX,
      y: y + offsetY,
      ...(bin === undefined ? {} : { bin }),
    })),
  ).flat();
}

describe('printer planning', () => {
  it('accepts a bin that fits after a 90-degree rotation', () => {
    const cells = rectangle(4, 5);

    expect(checkBedFit(cells, prusaMk4)).toMatchObject({
      fits: true,
      binWidth: 168,
      binDepth: 210,
      rotated: true,
    });
    expect(computeAutoSplitLines(cells, prusaMk4)).toEqual([]);
  });

  it('chooses the rotated split plan when it produces fewer pieces', () => {
    const cells = rectangle(6, 5);
    const lines = computeAutoSplitLines(cells, prusaMk4);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.axis).toBe('x');
    expect(checkPieceFit(cells, lines, prusaMk4)).toMatchObject({
      allFit: true,
      pieces: 2,
    });
  });

  it('returns a fitting plan for representative editor-sized footprints', () => {
    for (const [width, depth] of [[1, 1], [4, 5], [6, 5], [11, 9], [20, 13], [40, 40]]) {
      const cells = rectangle(width, depth);
      const lines = computeAutoSplitLines(cells, prusaMk4);
      expect(checkPieceFit(cells, lines, prusaMk4).allFit).toBe(true);
    }
  });

  it('keeps dense near-maximum layouts bounded while producing fitting pieces', () => {
    const printer: PrinterProfile = { name: 'Custom', bedWidth: 220, bedDepth: 220 };
    const cells = rectangle(36, 36);
    const lines = computeAutoSplitLines(cells, printer);

    expect(lines).toHaveLength(14);
    expect(checkPieceFit(cells, lines, printer)).toMatchObject({ allFit: true, pieces: 64 });
  });

  it('reports a failing piece instead of a larger fitting piece', () => {
    const cells = [
      ...rectangle(5, 4),
      ...rectangle(6, 1, 5),
    ];

    const result = checkPieceFit(cells, [{ axis: 'x', index: 5 }], prusaMk4);

    expect(result.allFit).toBe(false);
    expect(result.worst).toMatchObject({
      fits: false,
      binWidth: 252,
      binDepth: 42,
      col: 1,
      row: 0,
    });
    expect(result.failingPieces).toHaveLength(1);
  });

  it('evaluates separate logical bins independently', () => {
    const cells = [
      ...rectangle(4, 5, 0, 0, 0),
      ...rectangle(4, 5, 20, 0, 1),
    ];

    expect(checkBedFit(cells, prusaMk4).fits).toBe(true);
    expect(computeAutoSplitLines(cells, prusaMk4)).toEqual([]);
    expect(checkPieceFit(cells, [], prusaMk4)).toMatchObject({
      allFit: true,
      pieces: 2,
    });
  });

  it('identifies the logical bin that does not fit', () => {
    const cells = [
      ...rectangle(4, 4, 0, 0, 0),
      ...rectangle(6, 1, 20, 0, 1),
    ];

    expect(checkBedFit(cells, prusaMk4)).toMatchObject({ fits: false, bin: 1 });
  });

  it('shares a noncanonical split line when that reduces pieces across bins', () => {
    const printer: PrinterProfile = { name: 'Custom', bedWidth: 210, bedDepth: 210 };
    const cells = [
      ...rectangle(6, 1, 0, 0, 0),
      ...rectangle(6, 1, 2, 2, 1),
    ];

    const lines = computeAutoSplitLines(cells, printer);

    expect(lines).toEqual([{ axis: 'x', index: 4 }]);
    expect(checkPieceFit(cells, lines, printer)).toMatchObject({ allFit: true, pieces: 4 });
  });
});

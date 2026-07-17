import { describe, expect, it } from 'vitest';
import {
  addCutsUntilFit,
  availableCuts,
  closestCellBisection,
  cutKey,
  partitionCells,
} from './cuts';
import { checkBedFit } from './printers';
import type { Cell, PrinterSettings } from './types';

const smallPrinter: PrinterSettings = {
  name: 'Small',
  bedWidth: 100,
  bedDepth: 100,
  buildHeight: 100,
  headClearance: 5,
};

const irregular: Cell[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 1, y: 1 },
  { x: 0, y: 2 },
];
const uShape: Cell[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 2, y: 1 },
  { x: 0, y: 2 }, { x: 2, y: 2 },
];
const ring: Cell[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 2, y: 1 },
  { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
];

describe('editable cuts', () => {
  it('partitions a connected shape only across covered shared edges', () => {
    const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const cut = { start: { x: 1, y: 0 }, end: { x: 1, y: 1 } };
    expect(partitionCells(cells, [cut]).map((part) => part.cells.length)).toEqual([1, 2]);
  });

  it('offers multiple collinear segments where a ring hole interrupts a cut', () => {
    const line = availableCuts(ring).filter((cut) =>
      cut.start.x === 1 && cut.end.x === 1);
    expect(line.map(cutKey)).toEqual(['1,0:1,1', '1,2:1,3']);
    expect(closestCellBisection(ring).map(cutKey)).toEqual(['1,0:1,1', '1,2:1,3']);
  });

  it.each([
    ['irregular', irregular],
    ['U-shaped', uShape],
    ['ring-shaped', ring],
  ])('recursively creates fitting parts for a valid %s bin', (_name, cells) => {
    const cuts = addCutsUntilFit(cells, [], (part) => checkBedFit(part, smallPrinter).fits);
    const parts = partitionCells(cells, cuts);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => checkBedFit(part.cells, smallPrinter).fits)).toBe(true);
  });
});

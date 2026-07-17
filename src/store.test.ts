import { beforeEach, describe, expect, it } from 'vitest';
import { cutKey } from './lib/cuts';
import type { Design } from './lib/types';
import { DEFAULT_DESIGN, useAppStore } from './store';

function copyDesign(): Design {
  return structuredClone(DEFAULT_DESIGN);
}

beforeEach(() => {
  useAppStore.setState({ design: copyDesign(), selectedBinId: 'bin-1' });
});

describe('explicit design commands', () => {
  it('paints only the selected bin and starts a user-selected new bin', () => {
    const state = useAppStore.getState();
    state.startNewBin();
    const newId = useAppStore.getState().selectedBinId;
    useAppStore.getState().paintCell({ x: 2, y: 0 });
    const design = useAppStore.getState().design;
    expect(design.bins.find((bin) => bin.id === newId)?.cells).toEqual([{ x: 2, y: 0 }]);
    expect(design.bins.find((bin) => bin.id === 'bin-1')?.cells).toHaveLength(4);
  });

  it('resets bin-owned walls, openings, and cuts after a shape change', () => {
    const design = copyDesign();
    design.bins[0] = {
      ...design.bins[0],
      openings: [{ orientation: 'h', x: 0, y: 0 }],
      walls: [{ start: { x: 5, y: 5 }, end: { x: 20, y: 5 }, width: 1.2 }],
      cuts: [{ start: { x: 1, y: 0 }, end: { x: 1, y: 2 } }],
    };
    useAppStore.setState({ design });
    useAppStore.getState().paintCell({ x: 2, y: 0 });
    const bin = useAppStore.getState().design.bins[0];
    expect(bin.openings).toEqual([]);
    expect(bin.walls).toEqual([]);
    expect(bin.cuts).toEqual([]);
  });

  it('updates a coincident opening on both adjacent bins', () => {
    const design = copyDesign();
    design.bins = [
      { id: 'bin-1', cells: [{ x: 0, y: 0 }], openings: [], walls: [], cuts: [] },
      { id: 'bin-2', cells: [{ x: 1, y: 0 }], openings: [], walls: [], cuts: [] },
    ];
    useAppStore.setState({ design });
    const shared = { orientation: 'v' as const, x: 1, y: 0 };
    useAppStore.getState().toggleOpening(shared);
    expect(useAppStore.getState().design.bins.map((bin) => bin.openings)).toEqual([
      [shared],
      [shared],
    ]);
  });

  it('preserves user cuts on printer changes and adds only required cuts', () => {
    const design = copyDesign();
    const cells = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const existing = { start: { x: 3, y: 0 }, end: { x: 3, y: 1 } };
    design.bins[0] = { ...design.bins[0], cells, cuts: [existing] };
    useAppStore.setState({ design });
    useAppStore.getState().setPrinter({ name: 'Custom', bedWidth: 100, bedDepth: 100 });
    const cuts = useAppStore.getState().design.bins[0].cuts;
    expect(cuts.map(cutKey)).toContain(cutKey(existing));
    expect(cuts.length).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  editorCellToModel,
  editorCutToModel,
  editorEdgeToModel,
  editorWallToModel,
} from './coordinates';

describe('editor-to-model coordinates', () => {
  it('maps row-down cells and grid points into model +Y without a late mirror', () => {
    expect(editorCellToModel({ x: 2, y: 3 })).toEqual({ x: 2, y: -4 });
    expect(editorCutToModel({
      start: { x: 1, y: 2 },
      end: { x: 1, y: 5 },
    })).toEqual({
      start: { x: 1, y: -2 },
      end: { x: 1, y: -5 },
    });
  });

  it('maps canonical editor edges to the same physical model edges', () => {
    expect(editorEdgeToModel({ orientation: 'h', x: 2, y: 3 }))
      .toEqual({ orientation: 'h', x: 2, y: -3 });
    expect(editorEdgeToModel({ orientation: 'v', x: 2, y: 3 }))
      .toEqual({ orientation: 'v', x: 2, y: -4 });
  });

  it('normalizes free-form wall endpoints in millimetres', () => {
    expect(editorWallToModel({
      start: { x: 5, y: 8 },
      end: { x: 25, y: 18 },
      width: 1.6,
    })).toEqual({
      start: { x: 5, y: -8 },
      end: { x: 25, y: -18 },
      width: 1.6,
    });
  });
});

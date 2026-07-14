import { describe, expect, it } from 'vitest';
import { indexedMeshValidationError } from './meshValidation';

describe('indexed mesh validation', () => {
  it('accepts a finite indexed triangle', () => {
    expect(indexedMeshValidationError({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    })).toBeNull();
  });

  it('rejects empty, malformed, non-finite, and out-of-range meshes', () => {
    expect(indexedMeshValidationError({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    })).toMatch(/no vertices/i);
    expect(indexedMeshValidationError({
      positions: new Float32Array([0, 0]),
      indices: new Uint32Array([0, 1, 2]),
    })).toMatch(/xyz triples/i);
    expect(indexedMeshValidationError({
      positions: new Float32Array([0, 0, 0, Number.NaN, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    })).toMatch(/not finite/i);
    expect(indexedMeshValidationError({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 3]),
    })).toMatch(/outside the vertex array/i);
  });
});

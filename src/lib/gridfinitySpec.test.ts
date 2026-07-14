import { describe, expect, it } from 'vitest';
import {
  DESIGN_DEFAULTS,
  GRIDFINITY_DERIVED,
  GRIDFINITY_SPEC,
  IMPLEMENTATION_ALLOWANCES,
  gridfinityHeight,
} from './gridfinitySpec';

describe('Gridfinity specification', () => {
  it('keeps normative and derived compatibility measurements explicit', () => {
    expect(GRIDFINITY_SPEC.gridPitch).toBe(42);
    expect(GRIDFINITY_SPEC.heightUnit).toBe(7);
    expect(GRIDFINITY_SPEC.outerTopWidth).toBe(41.5);
    expect(GRIDFINITY_SPEC.outerCornerRadius).toBe(3.75);
    expect(GRIDFINITY_DERIVED.perimeterClearancePerSide).toBe(0.25);
    expect(GRIDFINITY_DERIVED.baseBridgeHeight).toBe(2.25);
  });

  it('calculates total height as units times seven millimetres', () => {
    expect(gridfinityHeight(2)).toBe(14);
    expect(gridfinityHeight(3)).toBe(21);
    expect(DESIGN_DEFAULTS.minimumHeightUnits).toBe(2);
  });

  it('keeps product defaults and implementation allowances outside the spec', () => {
    expect(DESIGN_DEFAULTS.filletRadius).toBe(2.8);
    expect(DESIGN_DEFAULTS.perimeterThickness).toBe(1.2);
    expect(IMPLEMENTATION_ALLOWANCES.csgOverlap).toBe(0.01);
    expect(IMPLEMENTATION_ALLOWANCES.multipartPreviewGap).toBe(0.3);
  });
});

import { gridfinityHeight, maximumFilletRadius } from './gridfinitySpec';
import type { Design } from './types';

/**
 * Frontend validation stage: returns a design safe to hand to the geometry
 * pipeline, which trusts its input and never clamps or validates.
 */
export function validateDesign(design: Design): Design {
  return {
    ...design,
    filletRadius: Math.min(
      design.filletRadius,
      maximumFilletRadius(gridfinityHeight(design.heightUnits)),
    ),
  };
}

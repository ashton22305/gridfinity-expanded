import { Stack } from '@mantine/core';
import {
  DESIGN_DEFAULTS,
  gridfinityHeight,
  maximumFilletRadius,
} from '../../../lib/gridfinitySpec';
import { useAppStore } from '../../../store';
import { SliderField } from '../../ui/SliderField';

export function DimensionsTab() {
  const design = useAppStore((state) => state.design);
  const setHeightUnits = useAppStore((state) => state.setHeightUnits);
  const setPerimeterThickness = useAppStore((state) => state.setPerimeterThickness);
  const setFilletRadius = useAppStore((state) => state.setFilletRadius);
  const filletMax = Math.min(8, maximumFilletRadius(gridfinityHeight(design.heightUnits)));
  const filletValue = Math.min(design.filletRadius, filletMax);

  return (
    <Stack gap="lg">
      <SliderField
        label="Height"
        min={DESIGN_DEFAULTS.minimumHeightUnits}
        max={20}
        step={1}
        value={design.heightUnits}
        onChange={setHeightUnits}
        display={`${design.heightUnits}u`}
        unit={`(${gridfinityHeight(design.heightUnits)} mm)`}
      />
      <SliderField
        label="Perimeter thickness"
        min={0.8}
        max={4}
        step={0.1}
        value={design.perimeterThickness}
        onChange={setPerimeterThickness}
        display={design.perimeterThickness.toFixed(1)}
        unit="mm"
        hint="The cavity floor remains fixed at 1.2 mm."
      />
      <SliderField
        label="Shared fillet"
        min={0}
        max={filletMax}
        step={0.2}
        value={filletValue}
        onChange={setFilletRadius}
        display={filletValue.toFixed(1)}
        unit="mm"
        hint="One radius rounds cavity corners and floor-to-wall transitions."
      />
    </Stack>
  );
}

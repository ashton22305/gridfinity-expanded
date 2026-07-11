import { ColorSwatch, Select, Stack } from '@mantine/core';
import type { BinSlope, SlopeDir } from '../../../lib/types';
import { BASE_TOTAL_HEIGHT, HEIGHT_PER_UNIT } from '../../../lib/geometry/gridfinity';
import { useAppStore } from '../../../store';
import { binColor } from '../binColors';
import { Hint } from '../../ui/Field';
import { SliderField } from '../../ui/SliderField';

const SLOPE_DIRS: { value: SlopeDir; label: string }[] = [
  { value: '-y', label: 'Low at top edge (as drawn in Shape)' },
  { value: '+y', label: 'Low at bottom edge' },
  { value: '-x', label: 'Low at left edge' },
  { value: '+x', label: 'Low at right edge' },
];

export function DimensionsTab() {
  const { config, updateConfig, updateBin } = useAppStore();
  const totalHeightMm = (BASE_TOTAL_HEIGHT + config.heightUnits * HEIGHT_PER_UNIT).toFixed(2);
  const bins = config.bins;

  const slopeFor = (id: number): BinSlope =>
    bins.find((bin) => bin.id === id)?.slope ?? { angle: 0, dir: '+y' };

  function setSlope(id: number, patch: Partial<BinSlope>) {
    const next = { ...slopeFor(id), ...patch };
    updateBin(id, { slope: next.angle > 0 ? next : undefined });
  }

  return (
    <Stack gap="lg">
      <SliderField
        label="Height"
        min={1} max={20} step={1}
        value={config.heightUnits}
        onChange={(v) => updateConfig({ heightUnits: v })}
        display={`${config.heightUnits}u`}
        unit={`(${totalHeightMm} mm)`}
      />

      <SliderField
        label="Wall thickness"
        min={0.8} max={4} step={0.1}
        value={config.wallThickness}
        onChange={(v) => updateConfig({ wallThickness: v })}
        display={config.wallThickness.toFixed(1)}
        unit="mm"
        hint="1.2 mm = 1 nozzle width (fastest print)"
      />

      <SliderField
        label="Cavity corner radius"
        min={0} max={20} step={0.25}
        value={config.cavityCornerRadius}
        onChange={(v) => updateConfig({ cavityCornerRadius: v })}
        display={config.cavityCornerRadius.toFixed(2)}
        unit="mm"
        hint="Rounds the inside corners only — the outer wall always follows the
          Gridfinity spec. Channels narrower than 2× the radius get filled."
      />

      <SliderField
        label="Inner fillet"
        min={0} max={10} step={0.25}
        value={config.innerFilletRadius}
        onChange={(v) => updateConfig({ innerFilletRadius: v })}
        display={config.innerFilletRadius.toFixed(2)}
        unit="mm"
        hint="Rounds the inside floor-to-wall edge for easier cleaning"
      />

      {bins.map(({ id }) => {
        const slope = slopeFor(id);
        return (
          <SliderField
            key={id}
            label={
              <>
                Base slope
                {bins.length > 1 && (
                  <>
                    {' — '}
                    <ColorSwatch
                      component="span"
                      color={binColor(id)}
                      size={10}
                      withShadow={false}
                      style={{ verticalAlign: 'text-bottom' }}
                    />
                    {` Bin ${id + 1}`}
                  </>
                )}
              </>
            }
            min={0} max={30} step={1}
            value={slope.angle}
            onChange={(v) => setSlope(id, { angle: v })}
            display={slope.angle.toFixed(0)}
            unit="°"
          >
            {slope.angle > 0 && (
              <Select
                data={SLOPE_DIRS}
                value={slope.dir}
                onChange={(v) => v && setSlope(id, { dir: v as SlopeDir })}
                aria-label={`Low side of the sloped base for bin ${id + 1}`}
              />
            )}
          </SliderField>
        );
      })}
      <Hint>
        Tilts a bin's cavity floor so contents slide to one side. Walls and the
        Gridfinity base stay standard.
      </Hint>
    </Stack>
  );
}

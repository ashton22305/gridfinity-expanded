import { Stack, Switch } from '@mantine/core';
import { useAppStore } from '../../../store';
import { Label } from '../../ui/Field';

export function FeaturesTab() {
  const { config, updateConfig } = useAppStore();

  return (
    <Stack gap="sm">
      <Label>Base attachment</Label>
      <Switch
        label="Magnet holes"
        description="6.5 mm × 2.4 mm recesses for N52 disc magnets (4 per cell)"
        checked={config.magnetHoles}
        onChange={(e) => updateConfig({ magnetHoles: e.currentTarget.checked })}
      />
      <Switch
        label="Screw holes"
        description="M3 pilot holes inside each magnet recess for mechanical lock"
        checked={config.screwHoles}
        onChange={(e) => updateConfig({ screwHoles: e.currentTarget.checked })}
      />
    </Stack>
  );
}

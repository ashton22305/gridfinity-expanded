import { useAppStore } from '../../../store';
import { Label } from '../../ui/Field';
import { Switch } from '../../ui/Switch';

export function FeaturesTab() {
  const { config, updateConfig } = useAppStore();

  return (
    <section className="flex flex-col">
      <div className="mb-2.5">
        <Label>Base attachment</Label>
      </div>
      <Switch
        label="Magnet holes"
        description="6.5 mm × 2.4 mm recesses for N52 disc magnets (4 per cell)"
        checked={config.magnetHoles}
        onChange={(v) => updateConfig({ magnetHoles: v })}
      />
      <Switch
        label="Screw holes"
        description="M3 pilot holes inside each magnet recess for mechanical lock"
        checked={config.screwHoles}
        onChange={(v) => updateConfig({ screwHoles: v })}
      />
    </section>
  );
}

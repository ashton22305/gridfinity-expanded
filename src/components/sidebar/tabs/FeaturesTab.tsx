import type { BinConfig } from '../../../lib/types';
import styles from './FeaturesTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
}

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <label className={styles.toggle}>
      <div className={styles.toggleInfo}>
        <span className={styles.toggleLabel}>{label}</span>
        <span className={styles.toggleDesc}>{description}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        className={`${styles.switch} ${checked ? styles.on : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </label>
  );
}

export function FeaturesTab({ config, onChange }: Props) {
  return (
    <div className={styles.tab}>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Base attachment</span>
        <Toggle
          label="Magnet holes"
          description="6.5 mm × 2.4 mm recesses for N52 disc magnets (4 per cell)"
          checked={config.magnetHoles}
          onChange={(v) => onChange({ ...config, magnetHoles: v })}
        />
        <Toggle
          label="Screw holes"
          description="M3 pilot holes inside each magnet recess for mechanical lock"
          checked={config.screwHoles}
          onChange={(v) => onChange({ ...config, screwHoles: v })}
        />
      </div>
    </div>
  );
}

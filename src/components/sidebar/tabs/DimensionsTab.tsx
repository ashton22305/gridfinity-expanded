import type { BinConfig } from '../../../lib/types';
import { BASE_TOTAL_HEIGHT, HEIGHT_PER_UNIT } from '../../../lib/geometry/gridfinity';
import styles from './DimensionsTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
}

export function DimensionsTab({ config, onChange }: Props) {
  const totalHeightMm = (BASE_TOTAL_HEIGHT + config.heightUnits * HEIGHT_PER_UNIT).toFixed(2);

  return (
    <div className={styles.tab}>
      <label className={styles.field}>
        <span className={styles.label}>Height</span>
        <div className={styles.inputRow}>
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={config.heightUnits}
            onChange={(e) => onChange({ ...config, heightUnits: Number(e.target.value) })}
            className={styles.slider}
          />
          <span className={styles.value}>
            {config.heightUnits}u
            <span className={styles.mm}> ({totalHeightMm} mm)</span>
          </span>
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Wall thickness</span>
        <div className={styles.inputRow}>
          <input
            type="number"
            min={0.8}
            max={4}
            step={0.1}
            value={config.wallThickness}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v >= 0.4) onChange({ ...config, wallThickness: v });
            }}
            className={styles.numberInput}
          />
          <span className={styles.unit}>mm</span>
        </div>
        <p className={styles.hint}>1.2 mm = 1 nozzle width (fastest print)</p>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Corner radius</span>
        <div className={styles.inputRow}>
          <input
            type="range"
            min={0}
            max={6}
            step={0.25}
            value={config.cornerRadius}
            onChange={(e) => onChange({ ...config, cornerRadius: Number(e.target.value) })}
            className={styles.slider}
          />
          <span className={styles.value}>
            {config.cornerRadius.toFixed(2)}
            <span className={styles.mm}> mm</span>
          </span>
        </div>
        <p className={styles.hint}>3.75 mm matches standard Gridfinity baseplates</p>
      </label>
    </div>
  );
}

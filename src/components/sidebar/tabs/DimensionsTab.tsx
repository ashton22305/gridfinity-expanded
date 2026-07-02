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
            type="range"
            min={0.8}
            max={4}
            step={0.1}
            value={config.wallThickness}
            onChange={(e) => onChange({ ...config, wallThickness: Number(e.target.value) })}
            className={styles.slider}
          />
          <span className={styles.value}>
            {config.wallThickness.toFixed(1)}
            <span className={styles.mm}> mm</span>
          </span>
        </div>
        <p className={styles.hint}>1.2 mm = 1 nozzle width (fastest print)</p>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Cavity corner radius</span>
        <div className={styles.inputRow}>
          <input
            type="range"
            min={0}
            max={20}
            step={0.25}
            value={config.cavityCornerRadius}
            onChange={(e) => onChange({ ...config, cavityCornerRadius: Number(e.target.value) })}
            className={styles.slider}
          />
          <span className={styles.value}>
            {config.cavityCornerRadius.toFixed(2)}
            <span className={styles.mm}> mm</span>
          </span>
        </div>
        <p className={styles.hint}>
          Rounds the inside corners only — the outer wall always follows the
          Gridfinity spec. Channels narrower than 2× the radius get filled.
        </p>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Inner fillet</span>
        <div className={styles.inputRow}>
          <input
            type="range"
            min={0}
            max={10}
            step={0.25}
            value={config.innerFilletRadius}
            onChange={(e) => onChange({ ...config, innerFilletRadius: Number(e.target.value) })}
            className={styles.slider}
          />
          <span className={styles.value}>
            {config.innerFilletRadius.toFixed(2)}
            <span className={styles.mm}> mm</span>
          </span>
        </div>
        <p className={styles.hint}>Rounds the inside floor-to-wall edge for easier cleaning</p>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Base slope</span>
        <div className={styles.inputRow}>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={config.baseAngle}
            onChange={(e) => onChange({ ...config, baseAngle: Number(e.target.value) })}
            className={styles.slider}
          />
          <span className={styles.value}>
            {config.baseAngle.toFixed(0)}
            <span className={styles.mm}>°</span>
          </span>
        </div>
        {config.baseAngle > 0 && (
          <div className={styles.inputRow}>
            <select
              className={styles.select}
              value={config.baseSlopeDir}
              onChange={(e) =>
                onChange({ ...config, baseSlopeDir: e.target.value as BinConfig['baseSlopeDir'] })}
              aria-label="Low side of the sloped base"
            >
              <option value="-y">Low at top edge (as drawn in Shape)</option>
              <option value="+y">Low at bottom edge</option>
              <option value="-x">Low at left edge</option>
              <option value="+x">Low at right edge</option>
            </select>
          </div>
        )}
        <p className={styles.hint}>
          Tilts the cavity floor so contents slide to one side. Walls and the
          Gridfinity base stay standard.
        </p>
      </label>
    </div>
  );
}

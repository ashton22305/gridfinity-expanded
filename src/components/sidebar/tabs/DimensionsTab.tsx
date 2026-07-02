import type { BinConfig, BinSlope, SlopeDir } from '../../../lib/types';
import { BASE_TOTAL_HEIGHT, HEIGHT_PER_UNIT } from '../../../lib/geometry/gridfinity';
import { groupBins } from '../../../lib/split';
import { binColor } from '../binColors';
import styles from './DimensionsTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
}

export function DimensionsTab({ config, onChange }: Props) {
  const totalHeightMm = (BASE_TOTAL_HEIGHT + config.heightUnits * HEIGHT_PER_UNIT).toFixed(2);
  const bins = groupBins(config.cells);

  const slopeFor = (id: number): BinSlope =>
    config.baseSlopes.find((s) => s.bin === id) ?? { bin: id, angle: 0, dir: '+y' };

  function setSlope(id: number, patch: Partial<BinSlope>) {
    const next = { ...slopeFor(id), ...patch };
    onChange({
      ...config,
      baseSlopes: [...config.baseSlopes.filter((s) => s.bin !== id), next]
        .sort((a, b) => a.bin - b.bin),
    });
  }

  return (
    <div className={styles.tab}>
      <label className={styles.field}>
        <span className={styles.label}>Height</span>
        <div className={styles.inputRow}>
          <input
            type="range"
            min={1}
            max={20}
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

      {bins.map(({ id }) => {
        const slope = slopeFor(id);
        return (
          <label key={id} className={styles.field}>
            <span className={styles.label}>
              Base slope
              {bins.length > 1 && (
                <>
                  {' — '}
                  <i className={styles.binDot} style={{ background: binColor(id) }} />
                  {` Bin ${id + 1}`}
                </>
              )}
            </span>
            <div className={styles.inputRow}>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={slope.angle}
                onChange={(e) => setSlope(id, { angle: Number(e.target.value) })}
                className={styles.slider}
              />
              <span className={styles.value}>
                {slope.angle.toFixed(0)}
                <span className={styles.mm}>°</span>
              </span>
            </div>
            {slope.angle > 0 && (
              <div className={styles.inputRow}>
                <select
                  className={styles.select}
                  value={slope.dir}
                  onChange={(e) => setSlope(id, { dir: e.target.value as SlopeDir })}
                  aria-label={`Low side of the sloped base for bin ${id + 1}`}
                >
                  <option value="-y">Low at top edge (as drawn in Shape)</option>
                  <option value="+y">Low at bottom edge</option>
                  <option value="-x">Low at left edge</option>
                  <option value="+x">Low at right edge</option>
                </select>
              </div>
            )}
          </label>
        );
      })}
      <p className={styles.hint}>
        Tilts a bin's cavity floor so contents slide to one side. Walls and the
        Gridfinity base stay standard.
      </p>
    </div>
  );
}

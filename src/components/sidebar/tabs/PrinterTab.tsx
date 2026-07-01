import { useState } from 'react';
import { PRINTER_PROFILES, checkBedFit } from '../../../lib/printers';
import type { GridCell, PrinterProfile } from '../../../lib/types';
import styles from './PrinterTab.module.css';

interface Props {
  cells: GridCell[];
  profile: PrinterProfile;
  onChange: (next: PrinterProfile) => void;
}

export function PrinterTab({ cells, profile, onChange }: Props) {
  const [isCustom, setIsCustom] = useState(profile.name === 'Custom');
  const bedFit = checkBedFit(cells, profile);

  function handlePresetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const found = PRINTER_PROFILES.find((p) => p.name === e.target.value);
    if (!found) return;
    setIsCustom(found.name === 'Custom');
    onChange(found);
  }

  return (
    <div className={styles.tab}>
      <label className={styles.field}>
        <span className={styles.label}>Printer</span>
        <select
          className={styles.select}
          value={profile.name}
          onChange={handlePresetChange}
        >
          {PRINTER_PROFILES.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {isCustom && (
        <div className={styles.customFields}>
          <label className={styles.field}>
            <span className={styles.label}>Bed width</span>
            <div className={styles.inputRow}>
              <input
                type="number"
                min={50}
                max={1000}
                value={profile.bedWidth}
                onChange={(e) =>
                  onChange({ ...profile, bedWidth: Number(e.target.value) })
                }
                className={styles.numberInput}
              />
              <span className={styles.unit}>mm</span>
            </div>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Bed depth</span>
            <div className={styles.inputRow}>
              <input
                type="number"
                min={50}
                max={1000}
                value={profile.bedDepth}
                onChange={(e) =>
                  onChange({ ...profile, bedDepth: Number(e.target.value) })
                }
                className={styles.numberInput}
              />
              <span className={styles.unit}>mm</span>
            </div>
          </label>
        </div>
      )}

      <div className={`${styles.bedInfo} ${bedFit.fits ? styles.fits : styles.noFit}`}>
        {cells.length === 0 ? (
          <span>Select cells in the Shape tab first.</span>
        ) : bedFit.fits ? (
          <span>
            ✓ Fits on {profile.name} ({profile.bedWidth} × {profile.bedDepth} mm bed)
          </span>
        ) : (
          <span>
            ⚠ This bin ({bedFit.binWidth} × {bedFit.binDepth} mm) is too large for
            the {profile.name} bed ({profile.bedWidth} × {profile.bedDepth} mm).
          </span>
        )}
      </div>
    </div>
  );
}

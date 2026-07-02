import type { BinConfig, PrinterProfile, SplitLine } from '../../../lib/types';
import { checkPieceFit } from '../../../lib/printers';
import { sortSplitLines } from '../../../lib/split';
import { binColor } from '../binColors';
import styles from './SplitTab.module.css';

interface Props {
  config: BinConfig;
  onChange: (next: BinConfig) => void;
  printerProfile: PrinterProfile;
  gridCols: number;
  gridRows: number;
}

const CELL = 40;   // svg units per cell
const PAD = 8;

function lineKey(l: SplitLine): string {
  return `${l.axis}:${l.index}`;
}

function toggleLine(lines: SplitLine[], l: SplitLine): SplitLine[] {
  const key = lineKey(l);
  const without = lines.filter((x) => lineKey(x) !== key);
  return sortSplitLines(without.length === lines.length ? [...lines, l] : without);
}

export function SplitTab({ config, onChange, printerProfile, gridCols, gridRows }: Props) {
  const { cells, splitMode, splitLines } = config;

  if (cells.length === 0) {
    return (
      <div className={styles.tab}>
        <p className={styles.hint}>Select cells in the Shape tab first.</p>
      </div>
    );
  }

  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const activeKeys = new Set(splitLines.map(lineKey));
  const isManual = splitMode === 'manual';

  // Candidate lines: every interior grid line of the bounding box.
  const candidates: SplitLine[] = [
    ...Array.from({ length: maxX - minX }, (_, i): SplitLine => ({ axis: 'x', index: minX + i + 1 })),
    ...Array.from({ length: maxY - minY }, (_, i): SplitLine => ({ axis: 'y', index: minY + i + 1 })),
  ];

  const fit = checkPieceFit(cells, splitLines, printerProfile);

  function lineEndpoints(l: SplitLine) {
    return l.axis === 'x'
      ? { x1: PAD + l.index * CELL, y1: PAD + minY * CELL, x2: PAD + l.index * CELL, y2: PAD + (maxY + 1) * CELL }
      : { x1: PAD + minX * CELL, y1: PAD + l.index * CELL, x2: PAD + (maxX + 1) * CELL, y2: PAD + l.index * CELL };
  }

  return (
    <div className={styles.tab}>
      <div className={styles.modeRow} role="radiogroup" aria-label="Split mode">
        <button
          className={`${styles.modeButton} ${!isManual ? styles.modeActive : ''}`}
          onClick={() => onChange({ ...config, splitMode: 'auto' })}
        >
          Auto (fit bed)
        </button>
        <button
          className={`${styles.modeButton} ${isManual ? styles.modeActive : ''}`}
          onClick={() => onChange({ ...config, splitMode: 'manual' })}
        >
          Manual
        </button>
      </div>

      <p className={styles.hint}>
        {isManual
          ? 'Click grid lines to split the bin into separately printed pieces.'
          : `Split lines are placed automatically so every piece fits the ${printerProfile.name} bed. Switch to Manual to adjust them.`}
      </p>

      <svg
        className={styles.editor}
        viewBox={`0 0 ${gridCols * CELL + PAD * 2} ${gridRows * CELL + PAD * 2}`}
        style={{ aspectRatio: `${gridCols * CELL + PAD * 2} / ${gridRows * CELL + PAD * 2}` }}
      >
        {Array.from({ length: gridRows }, (_, row) =>
          Array.from({ length: gridCols }, (_, col) => (
            <rect
              key={`bg${col},${row}`}
              className={styles.bgRect}
              x={PAD + col * CELL + 2}
              y={PAD + row * CELL + 2}
              width={CELL - 4}
              height={CELL - 4}
              rx={3}
            />
          ))
        )}
        {cells.map((c) => (
          <rect
            key={`c${c.x},${c.y}`}
            className={styles.cellRect}
            style={{ fill: binColor(c.bin), fillOpacity: 0.22 }}
            x={PAD + c.x * CELL}
            y={PAD + c.y * CELL}
            width={CELL}
            height={CELL}
          />
        ))}
        {candidates.map((l) => {
          const p = lineEndpoints(l);
          const active = activeKeys.has(lineKey(l));
          return (
            <g
              key={lineKey(l)}
              className={isManual ? styles.lineHit : styles.lineStatic}
              onClick={isManual
                ? () => onChange({ ...config, splitLines: toggleLine(splitLines, l) })
                : undefined}
            >
              <line {...p} className={styles.hitLine} />
              <line {...p} className={active ? styles.splitLine : styles.ghostLine} />
            </g>
          );
        })}
      </svg>

      <div className={`${styles.fitInfo} ${fit.allFit ? styles.fits : styles.noFit}`}>
        {fit.pieces <= 1 ? (
          fit.allFit
            ? <span>✓ Printed as a single bin — fits the {printerProfile.name} bed.</span>
            : <span>⚠ Too large for the {printerProfile.name} bed ({fit.worst.binWidth} × {fit.worst.binDepth} mm). Add split lines.</span>
        ) : fit.allFit ? (
          <span>✓ {fit.pieces} pieces — every piece fits the {printerProfile.name} bed.</span>
        ) : (
          <span>⚠ {fit.pieces} pieces, but the largest ({fit.worst.binWidth} × {fit.worst.binDepth} mm) still exceeds the {printerProfile.name} bed.</span>
        )}
      </div>

      {fit.pieces > 1 && (
        <p className={styles.hint}>
          Seams are open: glue the pieces together for one continuous bin.
          A divider placed on a split line becomes a closed wall on both pieces.
          Pieces keep their base pegs and sit on the baseplate like separate bins.
        </p>
      )}
    </div>
  );
}

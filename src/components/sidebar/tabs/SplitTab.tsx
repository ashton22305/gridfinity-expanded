import type { SplitLine } from '../../../lib/types';
import { checkPieceFit } from '../../../lib/printers';
import { lineKey, toggleSplitLine } from '../../../lib/split';
import { useAppStore } from '../../../store';
import { EditorCanvas } from '../EditorCanvas';
import { gridToSvg } from '../editorCoords';
import { Hint } from '../../ui/Field';
import { Button } from '../../ui/Button';
import { StatusBanner } from '../../ui/StatusBanner';

export function SplitTab() {
  const { config, updateConfig, printer, gridCols, gridRows } = useAppStore();
  const { cells, splitMode, splitLines } = config;

  if (cells.length === 0) {
    return <Hint>Select cells in the Shape tab first.</Hint>;
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

  const fit = checkPieceFit(cells, splitLines, printer);
  const worstSize = `${fit.worst.binWidth} × ${fit.worst.binDepth} mm`;
  let fitMessage: string;
  if (fit.pieces <= 1) {
    fitMessage = fit.allFit
      ? `Printed as a single bin — fits the ${printer.name} bed.`
      : `Too large for the ${printer.name} bed (${worstSize}). Add split lines.`;
  } else {
    fitMessage = fit.allFit
      ? `${fit.pieces} pieces — every piece fits the ${printer.name} bed.`
      : `${fit.pieces} pieces, but the largest (${worstSize}) still exceeds the ${printer.name} bed.`;
  }

  function lineEndpoints(l: SplitLine) {
    return l.axis === 'x'
      ? { x1: gridToSvg(l.index), y1: gridToSvg(minY), x2: gridToSvg(l.index), y2: gridToSvg(maxY + 1) }
      : { x1: gridToSvg(minX), y1: gridToSvg(l.index), x2: gridToSvg(maxX + 1), y2: gridToSvg(l.index) };
  }

  return (
    <div className="flex flex-col gap-3 select-none">
      <div className="flex gap-1.5" role="radiogroup" aria-label="Split mode">
        {(['auto', 'manual'] as const).map((mode) => (
          <Button
            key={mode}
            variant={splitMode === mode ? 'primary' : 'secondary'}
            className="flex-1 py-1.5 text-[0.8rem]"
            onClick={() => updateConfig({ splitMode: mode })}
          >
            {mode === 'auto' ? 'Auto (fit bed)' : 'Manual'}
          </Button>
        ))}
      </div>

      <Hint>
        {isManual
          ? 'Click grid lines to split the bin into separately printed pieces.'
          : `Split lines are placed automatically so every piece fits the ${printer.name} bed. Switch to Manual to adjust them.`}
      </Hint>

      <EditorCanvas gridCols={gridCols} gridRows={gridRows} cells={cells}>
        {candidates.map((l) => {
          const p = lineEndpoints(l);
          const active = activeKeys.has(lineKey(l));
          return (
            <g
              key={lineKey(l)}
              className={isManual ? 'group cursor-pointer' : 'cursor-default'}
              onClick={isManual
                ? () => updateConfig({ splitLines: toggleSplitLine(splitLines, l) })
                : undefined}
            >
              <line {...p} stroke="transparent" strokeWidth={12} strokeLinecap="round" />
              {active ? (
                <line
                  {...p}
                  className="pointer-events-none stroke-amber-500 group-hover:stroke-amber-400"
                  strokeWidth={3} strokeDasharray="7 4" strokeLinecap="round"
                />
              ) : (
                <line
                  {...p}
                  className="pointer-events-none stroke-zinc-600 [stroke-width:1] group-hover:stroke-amber-500 group-hover:[stroke-width:2]"
                  strokeDasharray="2 5" strokeLinecap="round"
                />
              )}
            </g>
          );
        })}
      </EditorCanvas>

      <StatusBanner ok={fit.allFit}>{fitMessage}</StatusBanner>

      {fit.pieces > 1 && (
        <Hint>
          Seams are open: glue the pieces together for one continuous bin.
          A divider placed on a split line becomes a closed wall on both pieces.
          Pieces keep their base pegs and sit on the baseplate like separate bins.
        </Hint>
      )}
    </div>
  );
}

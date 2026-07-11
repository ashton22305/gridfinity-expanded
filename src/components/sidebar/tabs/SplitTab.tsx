import { ColorSwatch, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import type { GridCell, LogicalBin, SplitLine } from '../../../lib/types';
import { checkPieceFit } from '../../../lib/printers';
import { flattenBins, lineKey, partitionCells, toggleSplitLine } from '../../../lib/split';
import { useAppStore } from '../../../store';
import { EditorCanvas } from '../EditorCanvas';
import { gridToSvg } from '../editorCoords';
import { binColor } from '../binColors';
import { Hint } from '../../ui/Field';
import { StatusBanner } from '../../ui/StatusBanner';

interface Fragment extends SplitLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Interior grid-edge fragments; no candidate extends outside its owning bin. */
function splitFragments(cells: GridCell[]): Fragment[] {
  const set = new Set(cells.map((c) => cellKey(c.x, c.y)));
  const fragments: Fragment[] = [];
  for (const cell of cells) {
    if (set.has(cellKey(cell.x + 1, cell.y))) {
      const line: SplitLine = { axis: 'x', index: cell.x + 1 };
      fragments.push({ ...line, key: `${lineKey(line)}:${cell.y}`, x1: gridToSvg(line.index),
        y1: gridToSvg(cell.y), x2: gridToSvg(line.index), y2: gridToSvg(cell.y + 1) });
    }
    if (set.has(cellKey(cell.x, cell.y + 1))) {
      const line: SplitLine = { axis: 'y', index: cell.y + 1 };
      fragments.push({ ...line, key: `${lineKey(line)}:${cell.x}`, x1: gridToSvg(cell.x),
        y1: gridToSvg(line.index), x2: gridToSvg(cell.x + 1), y2: gridToSvg(line.index) });
    }
  }
  return fragments;
}

export function SplitTab() {
  const { config, updateBin, printer, gridCols, gridRows } = useAppStore();
  const cells = flattenBins(config.bins);

  if (cells.length === 0) return <Hint>Select cells in the Shape tab first.</Hint>;

  const fit = checkPieceFit(config.bins, printer);

  function setManual(bin: LogicalBin, isManual: boolean) {
    updateBin(bin.id, { isManual });
  }

  function toggle(bin: LogicalBin, line: SplitLine) {
    if (bin.isManual) updateBin(bin.id, { splitLines: toggleSplitLine(bin.splitLines, line) });
  }

  return (
    <Stack className="no-select" gap="sm">
      <Hint>
        Each bin owns its split lines. Automatic bins are split only when needed
        to fit the {printer.name} bed.
      </Hint>

      <Stack gap="xs">
        {config.bins.map((bin) => {
          const pieces = partitionCells(bin.cells, bin.splitLines);
          return (
            <Group key={bin.id} justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <ColorSwatch color={binColor(bin.id)} size={12} withShadow={false} />
                <Text size="sm">Bin {bin.id + 1} · {pieces.length} piece{pieces.length !== 1 ? 's' : ''}</Text>
              </Group>
              <SegmentedControl
                size="xs"
                aria-label={`Split mode for bin ${bin.id + 1}`}
                value={bin.isManual ? 'manual' : 'auto'}
                onChange={(value) => setManual(bin, value === 'manual')}
                data={[{ label: 'Automatic', value: 'auto' }, { label: 'Manual', value: 'manual' }]}
              />
            </Group>
          );
        })}
      </Stack>

      <EditorCanvas gridCols={gridCols} gridRows={gridRows} cells={cells}>
        {config.bins.flatMap((bin) => {
          const active = new Set(bin.splitLines.map(lineKey));
          return splitFragments(bin.cells).map((fragment) => {
            const isActive = active.has(lineKey(fragment));
            const p = { x1: fragment.x1, y1: fragment.y1, x2: fragment.x2, y2: fragment.y2 };
            return (
              <g
                key={`${bin.id}:${fragment.key}`}
                className={bin.isManual ? 'split-line' : 'split-line is-static'}
                onClick={bin.isManual ? () => toggle(bin, fragment) : undefined}
              >
                <line {...p} className="split-line-hit" />
                <line
                  {...p}
                  className={`split-line-visible ${isActive
                    ? 'split-line-visible--active'
                    : 'split-line-visible--inactive'}`}
                  style={isActive ? { stroke: binColor(bin.id) } : undefined}
                />
              </g>
            );
          });
        })}
      </EditorCanvas>

      <StatusBanner ok={fit.allFit}>
        {fit.allFit
          ? `${fit.pieces} piece${fit.pieces !== 1 ? 's' : ''} — every piece fits the ${printer.name} bed.`
          : `${fit.pieces} pieces, but the largest (${fit.worst.binWidth} × ${fit.worst.binDepth} mm) still exceeds the ${printer.name} bed.`}
      </StatusBanner>

      {fit.pieces > config.bins.length && (
        <Hint>
          Split seams are open for gluing. A divider on a seam creates a closed
          wall on both pieces, and every piece retains its Gridfinity base pegs.
        </Hint>
      )}
    </Stack>
  );
}

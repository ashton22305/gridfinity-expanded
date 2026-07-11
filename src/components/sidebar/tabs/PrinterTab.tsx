import { NumberInput, Paper, Select, Stack } from '@mantine/core';
import { BED_MARGIN, PRINTER_PROFILES, bedMargin, checkPieceFit } from '../../../lib/printers';
import { totalHeightOf } from '../../../lib/geometry/gridfinity';
import { useAppStore } from '../../../store';
import { Hint } from '../../ui/Field';
import { StatusBanner } from '../../ui/StatusBanner';

export function PrinterTab() {
  const { config, printer, setPrinter } = useAppStore();
  const cells = config.bins.flatMap((bin) => bin.cells);
  const isCustom = printer.name === 'Custom';
  const modelHeight = totalHeightOf(config);
  const bedFit = checkPieceFit(config.bins, printer, modelHeight);

  const failures: string[] = [];
  if (!bedFit.heightFits && printer.bedHeight !== undefined) {
    failures.push(`The bin is ${modelHeight.toFixed(0)} mm tall — exceeds the
      ${printer.bedHeight} mm build height by ${(modelHeight - printer.bedHeight).toFixed(0)} mm.`);
  }
  for (const piece of bedFit.failingPieces) {
    const where = piece.col !== undefined ? ` (piece ${piece.col + 1},${(piece.row ?? 0) + 1})` : '';
    failures.push(`A ${piece.binWidth} × ${piece.binDepth} mm piece${where} is too large for the
      ${printer.bedWidth} × ${printer.bedDepth} mm bed with ${bedMargin(printer)} mm clearance.`);
  }

  return (
    <Stack gap="md">
      <Select
        label="Printer"
        data={PRINTER_PROFILES.map((p) => p.name)}
        value={printer.name}
        onChange={(name) => {
          const found = PRINTER_PROFILES.find((p) => p.name === name);
          // Head clearance is a user choice, not a machine property — keep it
          // across profile switches.
          if (found) setPrinter({ ...found, margin: printer.margin });
        }}
      />

      {isCustom && (
        <Paper p="sm" bg="dark.6">
          <Stack gap="sm">
            {([
              ['bedWidth', 'Bed width'],
              ['bedDepth', 'Bed depth'],
              ['bedHeight', 'Build height'],
            ] as const).map(([dim, label]) => (
              <NumberInput
                key={dim}
                label={label}
                min={50}
                max={1000}
                suffix=" mm"
                value={printer[dim]}
                onChange={(value) => setPrinter({ ...printer, [dim]: Number(value) })}
              />
            ))}
          </Stack>
        </Paper>
      )}

      <NumberInput
        label="Head clearance"
        description="Safety margin kept clear on every side of each piece"
        min={0}
        max={50}
        step={1}
        suffix=" mm"
        value={bedMargin(printer)}
        onChange={(value) => {
          const n = Number(value);
          if (!isNaN(n)) setPrinter({ ...printer, margin: n === BED_MARGIN ? undefined : n });
        }}
      />

      {cells.length === 0 ? (
        <Hint>Select cells in the Shape tab first.</Hint>
      ) : (
        <StatusBanner ok={bedFit.allFit}>
          {bedFit.allFit
            ? `Fits on ${printer.name} (${printer.bedWidth} × ${printer.bedDepth}${
                printer.bedHeight !== undefined ? ` × ${printer.bedHeight}` : ''} mm build volume)`
            : failures.join(' ')}
        </StatusBanner>
      )}
    </Stack>
  );
}

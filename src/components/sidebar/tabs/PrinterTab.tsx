import { NumberInput, Paper, Select, Stack } from '@mantine/core';
import { PRINTER_PROFILES, checkBedFit } from '../../../lib/printers';
import { useAppStore } from '../../../store';
import { Hint } from '../../ui/Field';
import { StatusBanner } from '../../ui/StatusBanner';

export function PrinterTab() {
  const { config, printer, setPrinter } = useAppStore();
  const cells = config.cells;
  const isCustom = printer.name === 'Custom';
  const bedFit = checkBedFit(cells, printer);

  return (
    <Stack gap="md">
      <Select
        label="Printer"
        data={PRINTER_PROFILES.map((p) => p.name)}
        value={printer.name}
        onChange={(name) => {
          const found = PRINTER_PROFILES.find((p) => p.name === name);
          if (found) setPrinter(found);
        }}
      />

      {isCustom && (
        <Paper p="sm" bg="dark.6">
          <Stack gap="sm">
            {([['bedWidth', 'Bed width'], ['bedDepth', 'Bed depth']] as const).map(([dim, label]) => (
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

      {cells.length === 0 ? (
        <Hint>Select cells in the Shape tab first.</Hint>
      ) : (
        <StatusBanner ok={bedFit.fits}>
          {bedFit.fits
            ? `Fits on ${printer.name} (${printer.bedWidth} × ${printer.bedDepth} mm bed)`
            : `This bin (${bedFit.binWidth} × ${bedFit.binDepth} mm) is too large for
               the ${printer.name} bed (${printer.bedWidth} × ${printer.bedDepth} mm).`}
        </StatusBanner>
      )}
    </Stack>
  );
}

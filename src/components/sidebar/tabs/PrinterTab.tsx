import { NumberInput, Paper, Select, Stack } from '@mantine/core';
import { PRINTER_PROFILES, checkDesignFit } from '../../../lib/printers';
import { gridfinityHeight } from '../../../lib/gridfinitySpec';
import { useAppStore } from '../../../store';
import { Hint } from '../../ui/Field';
import { StatusBanner } from '../../ui/StatusBanner';

export function PrinterTab() {
  const design = useAppStore((state) => state.design);
  const setPrinter = useAppStore((state) => state.setPrinter);
  const printer = design.printer;
  const isCustom = printer.name === 'Custom';
  const height = gridfinityHeight(design.heightUnits);
  const fit = checkDesignFit(design.bins, printer, height);
  const safeWidth = printer.bedWidth - printer.headClearance * 2;
  const safeDepth = printer.bedDepth - printer.headClearance * 2;
  const maximumClearance = Math.max(
    0,
    Math.min(50, (Math.min(printer.bedWidth, printer.bedDepth) - 1) / 2),
  );

  return (
    <Stack gap="md">
      <Select
        label="Printer"
        data={PRINTER_PROFILES.map((profile) => profile.name)}
        value={printer.name}
        onChange={(name) => {
          const profile = PRINTER_PROFILES.find((value) => value.name === name);
          if (profile) setPrinter({ ...profile, headClearance: printer.headClearance });
        }}
      />
      {isCustom && (
        <Paper p="sm" bg="dark.6">
          <Stack gap="sm">
            {([
              ['bedWidth', 'Bed width'],
              ['bedDepth', 'Bed depth'],
              ['buildHeight', 'Build height'],
            ] as const)
              .map(([dimension, label]) => (
                <NumberInput
                  key={dimension}
                  label={label}
                  min={50}
                  max={1000}
                  suffix=" mm"
                  value={printer[dimension]}
                  onChange={(value) => {
                    const next = { ...printer, [dimension]: Number(value) };
                    const maxClearance = Math.max(
                      0,
                      (Math.min(next.bedWidth, next.bedDepth) - 1) / 2,
                    );
                    setPrinter({
                      ...next,
                      headClearance: Math.min(next.headClearance, maxClearance),
                    });
                  }}
                />
              ))}
          </Stack>
        </Paper>
      )}
      <NumberInput
        label="Print head clearance"
        description="Safety inset on each side of the X/Y build plate"
        min={0}
        max={maximumClearance}
        decimalScale={1}
        suffix=" mm per side"
        value={printer.headClearance}
        onChange={(value) => setPrinter({ ...printer, headClearance: Number(value) })}
      />
      {design.bins.length === 0 ? (
        <Hint>Select cells in the Shape tab first.</Hint>
      ) : (
        <StatusBanner ok={fit.allFit}>
          {fit.allFit
            ? `${fit.parts} part${fit.parts !== 1 ? 's' : ''} fit the safe build volume (${safeWidth} × ${safeDepth} × ${printer.buildHeight} mm).`
            : `A part (${fit.worst.width} × ${fit.worst.depth} × ${height} mm) exceeds the safe build volume (${safeWidth} × ${safeDepth} × ${printer.buildHeight} mm) on ${fit.failedAxes.map((axis) => axis.toUpperCase()).join(', ')}.`}
        </StatusBanner>
      )}
    </Stack>
  );
}

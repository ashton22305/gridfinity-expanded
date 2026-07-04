import { PRINTER_PROFILES, checkBedFit } from '../../../lib/printers';
import { useAppStore } from '../../../store';
import { Field, Hint } from '../../ui/Field';
import { NumberInput, Select } from '../../ui/inputs';
import { StatusBanner } from '../../ui/StatusBanner';

export function PrinterTab() {
  const { config, printer, setPrinter } = useAppStore();
  const cells = config.cells;
  const isCustom = printer.name === 'Custom';
  const bedFit = checkBedFit(cells, printer);

  function handlePresetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const found = PRINTER_PROFILES.find((p) => p.name === e.target.value);
    if (found) setPrinter(found);
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Printer">
        <Select className="w-full px-2 py-1.5 text-[0.85rem]" value={printer.name} onChange={handlePresetChange}>
          {PRINTER_PROFILES.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      {isCustom && (
        <div className="flex flex-col gap-3 rounded-md bg-zinc-800/50 p-3">
          {([['bedWidth', 'Bed width'], ['bedDepth', 'Bed depth']] as const).map(([dim, label]) => (
            <Field key={dim} label={label}>
              <div className="flex items-center gap-2">
                <NumberInput
                  min={50}
                  max={1000}
                  value={printer[dim]}
                  onChange={(e) => setPrinter({ ...printer, [dim]: Number(e.target.value) })}
                  className="w-20 px-2 py-1"
                />
                <span className="text-[0.85rem] text-zinc-500">mm</span>
              </div>
            </Field>
          ))}
        </div>
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
    </div>
  );
}

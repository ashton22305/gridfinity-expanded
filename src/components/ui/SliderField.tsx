import type { ReactNode } from 'react';
import { Field } from './Field';

interface SliderFieldProps {
  label: ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** Formatted value shown next to the slider, e.g. "1.2". */
  display: string;
  /** Dimmed suffix after the value, e.g. "mm" or "(25.75 mm)". */
  unit?: string;
  hint?: ReactNode;
  /** Extra controls rendered between the slider row and the hint. */
  children?: ReactNode;
}

/** Range slider with a formatted readout — the standard numeric control. */
export function SliderField({
  label, min, max, step, value, onChange, display, unit, hint, children,
}: SliderFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 cursor-pointer accent-blue-600"
        />
        <span className="min-w-[90px] text-sm text-zinc-200">
          {display}
          {unit && <span className="text-xs text-zinc-500"> {unit}</span>}
        </span>
      </div>
      {children}
    </Field>
  );
}

import type { ReactNode } from 'react';

/** Uppercase section/field label used throughout the sidebar. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
      {children}
    </span>
  );
}

/** Muted helper text under a control or editor. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[0.8rem] text-zinc-500">{children}</p>;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

/** Labelled control block: label on top, control(s) below, optional hint. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </label>
  );
}

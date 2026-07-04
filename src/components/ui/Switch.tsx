interface SwitchProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Toggle switch row with a label and description. */
export function Switch({ label, description, checked, onChange }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-zinc-800 py-2.5 last:border-b-0">
      <div className="flex flex-col gap-1">
        <span className="text-[0.88rem] text-zinc-200">{label}</span>
        <span className="text-xs leading-snug text-zinc-500">{description}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] size-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-3.5' : ''
          }`}
        />
      </button>
    </label>
  );
}

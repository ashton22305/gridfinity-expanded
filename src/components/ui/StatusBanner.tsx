import type { ReactNode } from 'react';

interface StatusBannerProps {
  ok: boolean;
  children: ReactNode;
}

/** Green (ok) / amber (warning) info box, e.g. for bed-fit results. */
export function StatusBanner({ ok, children }: StatusBannerProps) {
  return (
    <div
      className={`rounded-md border px-3 py-2.5 text-[0.8rem] leading-relaxed ${
        ok
          ? 'border-green-500/25 bg-green-500/10 text-green-400'
          : 'border-amber-500/25 bg-amber-500/10 text-amber-400'
      }`}
    >
      {ok ? '✓' : '⚠'} {children}
    </div>
  );
}

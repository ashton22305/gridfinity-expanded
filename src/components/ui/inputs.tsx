import type { ComponentPropsWithoutRef } from 'react';

const CONTROL =
  'rounded border border-zinc-700 bg-zinc-800 text-zinc-200 focus:border-blue-600 focus:outline-none disabled:opacity-40';

/**
 * Small numeric text input in the shared control style. Carries no sizing of
 * its own — callers pass width/padding/text-size via className so utilities
 * never conflict.
 */
export function NumberInput({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input type="number" className={`${CONTROL} ${className}`} {...props} />;
}

/**
 * Native select in the shared control style. Carries no sizing of its own —
 * callers pass width/padding/text-size via className so utilities never
 * conflict (matching NumberInput).
 */
export function Select({ className = '', ...props }: ComponentPropsWithoutRef<'select'>) {
  return <select className={`${CONTROL} cursor-pointer ${className}`} {...props} />;
}

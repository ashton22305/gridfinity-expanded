import type { ComponentPropsWithoutRef } from 'react';

const VARIANTS = {
  primary: 'bg-blue-600 font-medium text-white enabled:hover:bg-blue-500',
  secondary: 'border border-zinc-700 bg-zinc-800 text-zinc-300 enabled:hover:bg-zinc-700',
};

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: keyof typeof VARIANTS;
}

/**
 * Standard action button. Carries no sizing of its own — callers pass
 * padding/text-size via className so utilities never conflict.
 */
export function Button({ variant = 'secondary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

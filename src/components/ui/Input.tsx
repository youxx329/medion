import { ComponentPropsWithRef } from 'react';

type InputProps = ComponentPropsWithRef<'input'>;

export default function input({ type = 'text', className = '', ...rest }: InputProps) {
  return (
    <input
      type={type}
      className={`h-11 w-full rounded-lg border border-line bg-white px-4 text-body-sm text-ink placeholder:text-disabled focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-skeleton disabled:text-disabled ${className}`}
      {...rest}
    />
  );
}

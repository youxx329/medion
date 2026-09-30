import type { ComponentPropsWithoutRef } from 'react';

type ButtonVariant = 'primary' | 'secondary';
type ButtonSize = 'md' | 'sm';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white',
  secondary: 'bg-sub text-ink',
};

const sizeClass: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-body',
  sm: 'h-9 px-4 text-body-sm',
};

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-full font-medium disabled:opacity-40 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

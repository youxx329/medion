import React from 'react';

type BadgeTone = 'neutral' | 'warning' | 'danger';

const toneClass: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-link',
  warning: 'bg-dur-warning-bg text-dur-warning-text border border-dur-warning-border',
  danger: 'bg-dur-danger-bg text-dur-danger-text border border-dur-danger-border',
};

type BadgeProps = {
  tone?: BadgeTone;
  children: React.ReactNode;
};

export default function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <div>
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 text-label font-medium ${toneClass[tone]}`}
      >
        {children}
      </span>
    </div>
  );
}

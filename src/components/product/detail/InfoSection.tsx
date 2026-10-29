import Image from 'next/image';
import { ReactNode } from 'react';

type InfoSectionProps = {
  title: string;
  body?: string | null;
  icon?: string;
  children?: ReactNode;
};

export default function InfoSection({ title, body, icon, children }: InfoSectionProps) {
  if (!children && !body?.trim()) return null;

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
        {icon && (
          <Image src={icon} alt="" width={20} height={20} aria-hidden className="shrink-0" />
        )}
        {title}
      </h2>
      {children ?? (
        <p className="max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-ink/80">
          {body?.replace(/\n{2,}/g, '\n')}
        </p>
      )}
    </section>
  );
}

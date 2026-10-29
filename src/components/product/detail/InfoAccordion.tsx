import { ChevronDown } from 'lucide-react';
import Image from 'next/image';

type InfoAccordionProps = {
  title: string;
  body: string | null;
  icon?: string;
};

export default function InfoAccordion({ title, body, icon }: InfoAccordionProps) {
  if (!body?.trim()) return null;

  return (
    <details className="info-accordion group relative before:absolute before:inset-x-0 before:top-0 before:border-b before:border-dashed before:border-skeleton before:bg-line">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          {icon && (
            <Image src={icon} alt="" width={20} height={20} aria-hidden className="shrink-0" />
          )}

          {title}
        </h2>
        <ChevronDown
          className="size-4.5 text-ink transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <p className="whitespace-pre-line pb-5 text-[15px] leading-relaxed text-ink/80">
        {body.replace(/\n{2,}/g, '\n')}
      </p>
    </details>
  );
}

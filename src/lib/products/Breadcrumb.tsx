import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export type Crumb = { label: string; href?: string };

type BreadcrumbProps = { items: Crumb[] };

export default function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="현재 위치">
      <ol className="flex flex-wrap items-center gap-1.5 text-body">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 text-disabled" aria-hidden />}
            {item.href ? (
              <Link href={item.href} className="text-disabled transition-colors hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// 바뀌는 것 : 경로 항목들 (이름, 링크)
// 고정 : 화살표 구분자, 마지막 항목은 링크 없이 진하게

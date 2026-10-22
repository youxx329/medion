import { buildProductsHref, type ProductSearch } from '@/src/lib/products/search-params';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

type PaginationProps = {
  search: ProductSearch;
  totalPages: number;
};

export default function Pagination({ search, totalPages }: PaginationProps) {
  if (totalPages <= 1) return null; // 1페이지뿐이면 숫자 "1" 하나 덩그러니 두지 않는다
  const current = search.page;
  const BLOCK = 10;
  const blockStart = Math.floor((current - 1) / BLOCK) * BLOCK + 1; // 현재 묶음 첫 번호
  const blockEnd = Math.min(blockStart + BLOCK - 1, totalPages); // 현재 묶음 끝 번호

  const pages = Array.from({ length: blockEnd - blockStart + 1 }, (_, i) => blockStart + i);

  return (
    <nav aria-label="페이지" className="flex items-center justify-center gap-1 pt-10">
      {current > 1 && (
        <Link
          href={buildProductsHref(search, { page: current - 1 })}
          aria-label="이전 페이지"
          className="flex size-9 items-center justify-center rounded-full text-ink hover:bg-surface"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      )}

      {pages.map((n) =>
        n === current ? (
          <span
            key={n}
            aria-current="page"
            className="flex size-9 items-center justify-center rounded-full bg-ink text-label text-white"
          >
            {n}
          </span>
        ) : (
          <Link
            key={n}
            href={buildProductsHref(search, { page: n })}
            className="flex size-9 items-center justify-center rounded-full text-label text-ink hover:bg-surface"
          >
            {n}
          </Link>
        )
      )}

      {current < totalPages && (
        <Link
          href={buildProductsHref(search, { page: current + 1 })}
          aria-label="다음 페이지"
          className="flex size-9 items-center justify-center rounded-full text-ink hover:bg-surface"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </nav>
  );
}

// 바뀌는 것 : 현재 페이지, 전체 페이지 수
// 고정 : 버튼 모양, 1페이지면 안 그림

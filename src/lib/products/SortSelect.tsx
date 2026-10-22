'use client';

import {
  SORTS,
  buildProductsHref,
  type ProductSearch,
  type SortKey,
} from '@/src/lib/products/search-params';
import { useRouter } from 'next/navigation';

const SORT_LABELS: Record<SortKey, string> = {
  sales: '판매량순',
  price_asc: '가격 낮은순',
  price_desc: '가격 높은순',
};

type SortSelectProps = { search: ProductSearch };

export default function SortSelect({ search }: SortSelectProps) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-body">
      <span className="text-disabled">정렬</span>
      <select
        value={search.sort}
        onChange={(e) => {
          const sort = SORTS.find((s) => s === e.target.value) ?? 'sales';
          router.push(buildProductsHref(search, { sort, page: 1 }));
        }}
        className="cursor-pointer bg-transparent text-ink"
      >
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {SORT_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

// 바뀌는 것 : 현재 정렬 (search.sort)
// 고정 : 정렬 3종과 한글 이름

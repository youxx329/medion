'use client';

import { type ProductSearch, countActiveFilters } from '@/src/lib/products/search-params';
import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import FilterPanel from './FilterPanel';

type MobileFilterSheetProps = {
  search: ProductSearch;
  total: number;
};

export default function MobileFilterSheet({ search, total }: MobileFilterSheetProps) {
  const [open, setOpen] = useState(false);
  const selectedCount = countActiveFilters(search);

  // 열려 있는 동안: 뒤 페이지 스크롤 막기 + Esc로 닫기
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    // 창이 데스크톱 폭(lg)으로 커지면 시트를 닫음. CSS로만 숨겨지면 스크롤 잠금이 안 풀려서
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onResize = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    desktop.addEventListener('change', onResize);

    // 닫힐 때(또는 컴포넌트가 사라질 때) 원래대로
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onResize);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      {/* 여는 버튼 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-full border border-sub px-3.5 text-[15px] font-medium text-ink cursor-pointer"
      >
        <SlidersHorizontal className="size-4.5" strokeWidth={1.8} aria-hidden />
        필터
        {selectedCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-semibold text-white">
            {selectedCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* 배경: 누르면 닫힘 */}
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* 시트: 배경과 형제 (안에 넣으면 클릭이 배경까지 올라가서 닫힘) */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="필터"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-3xl bg-white"
          >
            {/* 위: 손잡이 + 닫기 */}
            <div className="flex-none px-5 pt-2">
              <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-[#D9E7E4]" />
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-label="닫기"
                  onClick={() => setOpen(false)}
                  className="flex size-11 items-center justify-center text-ink cursor-pointer"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* 가운데: 필터 내용만 스크롤 */}
            <div className="flex-1 overflow-y-auto px-5">
              <FilterPanel search={search} />
            </div>

            {/* 아래: 항상 보이는 닫기 버튼 */}
            <div className="flex-none border-t border-[#D9E7E4] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-13 w-full rounded-full bg-ink text-base font-semibold text-white cursor-pointer"
              >
                상품 {total.toLocaleString('ko-KR')}개 보기
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

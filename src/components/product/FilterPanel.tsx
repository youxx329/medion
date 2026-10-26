'use client';

import {
  FORM_CODES,
  buildProductsHref,
  countActiveFilters,
  type FormCode,
  type ProductSearch,
} from '@/src/lib/products/search-params';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const FORM_OPTIONS = Object.keys(FORM_CODES) as FormCode[];

type FilterPanelProps = { search: ProductSearch };

export default function FilterPanel({ search }: FilterPanelProps) {
  const router = useRouter();

  const selectedCount = countActiveFilters(search);

  /** 필터 하나를 바꿔서 이동. 카테고리·정렬은 유지하고 1페이지부터 */
  const go = (patch: Partial<ProductSearch>) => {
    router.push(buildProductsHref(search, { ...patch, page: 1 }), { scroll: false });
  };

  /** 있으면 빼고, 없으면 넣은 새 배열 */
  const toggleForm = (code: FormCode) => {
    const next = search.forms.includes(code)
      ? search.forms.filter((f) => f !== code)
      : [...search.forms, code];
    go({ forms: next });
  };

  return (
    <div className="flex flex-col text-ink">
      {/* 헤더 */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">필터</h2>
          {selectedCount > 0 && (
            <span className="flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-ink px-1.5 text-xs font-semibold text-white">
              {selectedCount}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={selectedCount === 0}
          onClick={() => go({ forms: [], child: false })}
          className="min-h-11 text-sm underline underline-offset-[3px] disabled:cursor-default disabled:text-[#5F7178] disabled:no-underline cursor-pointer"
        >
          전체 해제
        </button>
      </div>

      {/* 증상: 준비 중 */}
      <FilterGroup title="증상" badge="준비 중">
        <p className="text-[13px] leading-relaxed text-[#5F7178]">
          머리가 아파요 처럼 증상으로 고르는 기능을 준비하고 있어요.
        </p>
      </FilterGroup>

      {/* 제형 */}
      <FilterGroup title="제형">
        <ul>
          {FORM_OPTIONS.map((code) => (
            <li key={code}>
              <FilterCheckbox
                label={FORM_CODES[code]}
                checked={search.forms.includes(code)}
                onChange={() => toggleForm(code)}
              />
            </li>
          ))}
        </ul>
      </FilterGroup>

      {/* 연령 */}
      <FilterGroup title="연령">
        <FilterCheckbox
          label="어린이도 먹을 수 있는 상품만"
          checked={search.child}
          onChange={() => go({ child: !search.child })}
        />
        <p className="ml-8 text-[13px] leading-relaxed text-[#5F7178]">
          몇 살부터인지는 배지(예: 3세+)에서 확인하고, 먹이기 전에 용법을 꼭 읽어주세요.
        </p>
      </FilterGroup>

      {/* 내 약과 안 맞는 상품: 로그인 + DUR 이후 */}
      <FilterGroup title="내 약과 안 맞는 상품">
        <div className="mt-2 flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <label className="flex min-h-11 cursor-not-allowed items-center justify-between text-[15px] text-[#5F7178]">
            숨기기
            <input type="checkbox" role="switch" disabled className="peer sr-only" />
            <span
              aria-hidden
              className="flex h-6 w-10 items-center rounded-full bg-[#C9D8D5] p-[3px]"
            >
              <span className="size-[18px] rounded-full bg-white" />
            </span>
          </label>
          <p className="text-[13px] leading-relaxed text-[#2F4A53]">
            등록한 복용 약과 함께 먹으면 안 되거나 주의가 필요한 상품을 목록에서 숨겨드려요.
          </p>
          <Link
            href="/login"
            className="flex min-h-11 items-center justify-center rounded-full bg-sub text-sm font-semibold"
          >
            로그인하고 사용하기
          </Link>
          <p className="text-xs leading-relaxed text-[#5F7178]">
            건강기능식품은 검사 대상이 아니에요.
          </p>
        </div>
      </FilterGroup>
    </div>
  );
}

// ─── 이 파일에서만 쓰는 조각 ─────────────────────────

type FilterGroupProps = {
  title: string;
  badge?: string;
  children: React.ReactNode;
};

/** 제목 + 내용. 구분선은 바깥 div에 (fieldset에 border를 주면 legend가 선 위에 걸림) */
function FilterGroup({ title, badge, children }: FilterGroupProps) {
  return (
    <div className="border-t border-[#D9E7E4] pb-6 pt-5">
      <fieldset className="min-w-0">
        <legend className="mb-1 flex w-full items-center justify-between text-[15px] font-semibold">
          {title}
          {badge && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-[#5F7178]">
              {badge}
            </span>
          )}
        </legend>
        {children}
      </fieldset>
    </div>
  );
}

type FilterCheckboxProps = {
  label: string;
  checked: boolean;
  onChange: () => void;
};

function FilterCheckbox({ label, checked, onChange }: FilterCheckboxProps) {
  return (
    <label className="group flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] border-[#9CC9BE] transition-colors group-hover:border-primary peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
      >
        {checked && <Check className="size-3 text-white" strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

export const PAGE_SIZE = 12;

/** URL 에 쓰는 제형 코드 → DB dosage_form 값 */
export const FORM_CODES = {
  tablet: '정제',
  capsule: '캡슐',
  liquid: '시럽·액상',
  powder: '산제·과립',
  topical: '외용',
} as const;
export type FormCode = keyof typeof FORM_CODES;

export const SORTS = ['sales', 'price_asc', 'price_desc'] as const;
export type SortKey = (typeof SORTS)[number];

export type ProductSearch = {
  category: string | null;
  forms: FormCode[];
  child: boolean;
  sort: SortKey;
  page: number;
};

export const DEFAULT_SEARCH: ProductSearch = {
  category: null,
  forms: [],
  child: false,
  sort: 'sales',
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

/** ?a=1&a=2 처럼 같은 키가 여러 번 오면 배열이 된다. 첫 번째만 쓴다 */
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 잘못된 값은 에러 없이 기본값으로 */
export function parseProductSearch(sp: RawParams): ProductSearch {
  const category = first(sp.category)?.trim() || null;

  const forms = (first(sp.form) ?? '')
    .split(',')
    .filter((f): f is FormCode => Object.hasOwn(FORM_CODES, f));

  const sortRaw = first(sp.sort);
  const sort = SORTS.find((s) => s === sortRaw) ?? 'sales';

  const pageNum = Number(first(sp.page));
  const page = Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1;

  return { category, forms: [...new Set(forms)], child: first(sp.child) === '1', sort, page };
}

/** ProductSearch → URL. 기본값은 주소에서 뺀다 */
export function buildProductsHref(search: ProductSearch, patch: Partial<ProductSearch> = {}) {
  const s = { ...search, ...patch };
  const params = new URLSearchParams();
  if (s.category) params.set('category', s.category);
  if (s.forms.length > 0) params.set('form', s.forms.join(','));
  if (s.child) params.set('child', '1');
  if (s.sort !== 'sales') params.set('sort', s.sort);
  if (s.page > 1) params.set('page', String(s.page));
  const qs = params.toString();
  return qs ? `/products?${qs}` : '/products';
}

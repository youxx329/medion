import { createClient } from '@/src/lib/supabase/server';
import { CHILD_AGE_LIMIT_MONTHS } from './child-age';
import { FORM_CODES, PAGE_SIZE, type ProductSearch, type SortKey } from './search-params';

const LIST_COLUMNS = 'id, code, name, price, image_key, dosage_form, child_min_age_months, stock';

const SORT_ORDER: Record<SortKey, { column: string; ascending: boolean }> = {
  sales: { column: 'sales_count', ascending: false },
  price_asc: { column: 'price', ascending: true },
  price_desc: { column: 'price', ascending: false },
};

export type CategoryInfo = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  parent: { name: string; slug: string } | null;
};

/** slug → 카테고리. 대분류면 자식 중분류 id 까지 */
async function resolveCategory(slug: string) {
  const supabase = await createClient();
  const { data: category, error } = await supabase
    .from('categories')
    .select('id, name, slug, parent_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`카테고리 조회 실패: ${error.message}`);
  if (category === null) return null; // 없는 slug → 전체 상품으로

  // 중분류: 부모 이름은 경로 표시용
  if (category.parent_id !== null) {
    const { data: parent, error: parentError } = await supabase
      .from('categories')
      .select('name, slug')
      .eq('id', category.parent_id)
      .single();
    if (parentError) throw new Error(`상위 카테고리 조회 실패: ${parentError.message}`);
    const info: CategoryInfo = { ...category, parent };
    return { category: info, ids: [category.id] };
  }

  // 대분류: 상품은 중분류에만 붙어 있으니 자식들 id 로 찾는다
  const { data: children, error: childError } = await supabase
    .from('categories')
    .select('id')
    .eq('parent_id', category.id);
  if (childError) throw new Error(`중분류 조회 실패: ${childError.message}`);
  const info: CategoryInfo = { ...category, parent: null };
  return { category: info, ids: children.map((c) => c.id) };
}

export async function getProducts(search: ProductSearch) {
  const supabase = await createClient();
  const resolved = search.category ? await resolveCategory(search.category) : null;

  let query = supabase
    .from('products')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('is_active', true);

  if (resolved) query = query.in('category_id', resolved.ids);
  if (search.forms.length > 0)
    query = query.in(
      'dosage_form',
      search.forms.map((f) => FORM_CODES[f])
    );
  if (search.child) query = query.lt('child_min_age_months', CHILD_AGE_LIMIT_MONTHS);

  const { column, ascending } = SORT_ORDER[search.sort];
  query = query.order(column, { ascending }).order('id', { ascending: true }); // 동점 처리

  const from = (search.page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);

  // 마지막 페이지보다 큰 page 를 요청하면 Supabase 가 에러로 응답한다
  if (error?.code === 'PGRST103') return { status: 'out-of-range' as const };
  if (error) throw new Error(`상품 조회 실패: ${error.message}`);
  if (data === null || count === null) throw new Error('상품 조회 결과가 비어 있음');

  return {
    status: 'ok' as const,
    products: data,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
    category: resolved?.category ?? null,
  };
}

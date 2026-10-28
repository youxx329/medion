import { type Crumb } from './Breadcrumb';
import { type CategoryInfo } from './queries';
import { buildProductsHref, DEFAULT_SEARCH } from './search-params';

/** 홈 > 전체 상품 > 대분류 > 중분류. 마지막은 현재 위치라 링크 없음 */
export function buildCrumbs(
  category: CategoryInfo | null,
  { linkCurrent = false }: { linkCurrent?: boolean } = {}
): Crumb[] {
  const crumbs: Crumb[] = [{ label: '홈', href: '/' }];
  if (category === null) return [...crumbs, { label: '전체 상품' }];

  crumbs.push(
    linkCurrent
      ? {
          label: category.name,
          href: buildProductsHref(DEFAULT_SEARCH, { category: category.slug }),
        }
      : { label: category.name }
  );

  return crumbs;
}

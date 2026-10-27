import Container from '@/src/components/layout/Container';
import FilterPanel from '@/src/components/product/FilterPanel';
import MobileFilterSheet from '@/src/components/product/MobileFilterSheet';
import ProductCard from '@/src/components/product/ProductCard';
import Breadcrumb, { type Crumb } from '@/src/lib/products/Breadcrumb';
import Pagination from '@/src/lib/products/Pagination';
import { getProducts, type CategoryInfo } from '@/src/lib/products/queries';
import {
  buildProductsHref,
  DEFAULT_SEARCH,
  parseProductSearch,
} from '@/src/lib/products/search-params';
import SortSelect from '@/src/lib/products/SortSelect';
import Link from 'next/link';
import { redirect } from 'next/navigation';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 홈 > 전체 상품 > 대분류 > 중분류. 마지막은 현재 위치라 링크 없음 */
function buildCrumbs(category: CategoryInfo | null): Crumb[] {
  const crumbs: Crumb[] = [{ label: '홈', href: '/' }];
  if (category === null) return [...crumbs, { label: '전체 상품' }];

  crumbs.push({ label: '전체 상품', href: '/products' });
  if (category.parent) {
    crumbs.push({
      label: category.parent.name,
      href: buildProductsHref(DEFAULT_SEARCH, { category: category.parent.slug }),
    });
  }
  crumbs.push({ label: category.name });
  return crumbs;
}

export default async function ProductsPage({ searchParams }: Props) {
  const search = parseProductSearch(await searchParams);
  const result = await getProducts(search);

  if (result.status === 'out-of-range') redirect(buildProductsHref(search, { page: 1 }));

  const title = result.category?.name ?? '전체 상품';

  return (
    <main className="pb-20">
      <Container className="flex flex-col gap-8 pt-10">
        {/* 위: 경로 · 제목 · 정렬 */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3">
            <Breadcrumb items={buildCrumbs(result.category)} />
            <h1 className="text-h2 text-ink">
              {title}
              <span className="ml-2 text-body-lg text-disabled">{result.total}개</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 justify-between">
            <MobileFilterSheet search={search} total={result.total} />
            <SortSelect search={search} />
          </div>
        </div>

        {/* 아래: 필터 · 그리드 */}
        <div className="flex gap-10">
          <aside className="hidden w-60 shrink-0 lg:block">
            <FilterPanel search={search} />
          </aside>

          <section className="flex-1">
            {result.products.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-24 text-center">
                <p className="text-body-lg text-ink">조건에 맞는 상품이 없어요</p>
                <Link
                  href={buildProductsHref(search, { forms: [], child: false, page: 1 })}
                  className="text-label text-disabled underline hover:text-ink"
                >
                  필터 초기화
                </Link>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-x-6 lg:grid-cols-3">
                {result.products.map((product) => (
                  <li key={product.id}>
                    <ProductCard product={product} />
                  </li>
                ))}
              </ul>
            )}

            <Pagination search={search} totalPages={result.totalPages} />
          </section>
        </div>
      </Container>
    </main>
  );
}

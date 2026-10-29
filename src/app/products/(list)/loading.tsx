import Container from '@/src/components/layout/Container';
import ProductCardSkeleton from '@/src/components/product/ProductCardSkeleton';
import Skeleton from '@/src/components/ui/Skeleton';
import { PAGE_SIZE } from '@/src/lib/products/search-params';

export default function Loading() {
  return (
    <main className="pb-20">
      <Container className="flex flex-col gap-8 pt-10">
        {/* 위: 경로 · 제목 · 정렬 */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3">
            <div className="text-body flex h-[1lh] items-center">
              <Skeleton className="h-[1em] w-32" />
            </div>
            {/* 제목: page.tsx의 h1에 쓴 글자 클래스 그대로 */}
            <div className="text-h2 flex h-[1lh] items-center">
              <Skeleton className="h-[1em] w-44" />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-between">
            <Skeleton className="h-10 w-20 rounded-full lg:hidden" />
            <Skeleton className="h-6 w-32" />
          </div>
        </div>

        {/* 아래: 필터 · 그리드 */}
        <div className="flex gap-10">
          <aside className="hidden w-60 shrink-0 flex-col gap-6 lg:flex">
            <div className="flex min-h-11 items-center">
              <Skeleton className="h-6 w-16" />
            </div>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </aside>

          <section className="flex-1">
            <ul className="grid grid-cols-2 gap-x-6 lg:grid-cols-3">
              {Array.from({ length: PAGE_SIZE }, (_, i) => (
                <li key={i}>
                  <ProductCardSkeleton />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Container>
    </main>
  );
}

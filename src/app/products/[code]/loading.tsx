import Container from '@/src/components/layout/Container';
import Skeleton from '@/src/components/ui/Skeleton';

export default function Loading() {
  return (
    <Container className="flex flex-col gap-6 pt-10 pb-40 md:pb-0">
      {/* 브레드크럼 */}
      <div className="flex h-[1lh] items-center text-body">
        <Skeleton className="h-[1em] w-56" />
      </div>

      <section className="flex flex-col gap-6 md:flex-row md:gap-10">
        {/* 이미지 */}
        <Skeleton className="aspect-square w-full shrink-0 rounded-lg md:w-1/2 lg:max-w-lg" />

        {/* 정보 */}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex h-[1lh] items-center text-sm">
            <Skeleton className="h-[1em] w-32" />
          </div>
          <div className="text-h2 flex h-[1lh] items-center">
            <Skeleton className="h-[1em] w-60" />
          </div>
          <Skeleton className="h-6 w-12" />
          <div className="flex h-[1lh] items-center text-xl">
            <Skeleton className="h-[1em] w-24" />
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />

          {/* 구매 영역 (md 이상에서만 이 자리) */}
          <div className="mt-4 hidden flex-col gap-3 md:flex">
            <Skeleton className="h-[78px] w-full rounded-md" />
            <Skeleton className="h-[33px] w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-14 flex-1" />
              <Skeleton className="h-14 flex-1" />
            </div>
          </div>
        </div>
      </section>
    </Container>
  );
}

import Skeleton from '@/src/components/ui/Skeleton';

export default function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-5 pb-10" aria-hidden>
      {/* 이미지: 실제 카드랑 같은 3:4 */}
      <Skeleton className="aspect-3/4 w-full rounded-xl" />

      {/* 이름 + 배지: 실제 카드의 mt-5 / gap-1.5 그대로 */}
      <div className="mt-2 flex flex-col gap-1.5">
        <Skeleton className="h-6 w-3/4" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-5 w-12" />
        </div>
      </div>

      {/* 버튼 + 가격: h-10 줄 */}
      <div className="flex h-10 items-center justify-between mt-1">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-5 w-20" />
      </div>
    </div>
  );
}

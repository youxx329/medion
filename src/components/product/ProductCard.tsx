import DurBadge, { type DurBadgeLevel } from '@/src/components/dur/DurBadge';
import Badge from '@/src/components/ui/Badge';
import { childBadgeLabel } from '@/src/lib/products/child-age';
import type { Product } from '@/src/types/product';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import ProductImage from './ProductImage';

type ProductCardProps = {
  product: Product;
  durLevel?: DurBadgeLevel;
};

export default function ProductCard({ product, durLevel }: ProductCardProps) {
  const soldOut = product.stock === 0;
  const childAge = product.child_min_age_months;
  const childBadge = childBadgeLabel(product.child_min_age_months, product.is_kids_product);

  return (
    <article className="flex h-full gap-5 flex-col pb-10">
      <Link href={`/products/${product.code}`}>
        <div className="relative">
          <ProductImage
            imageKey={product.image_key}
            name={product.name}
            className={soldOut ? 'opacity-50' : ''}
          />
          {durLevel && (
            <div className="absolute left-5 top-0">
              <DurBadge level={durLevel} />
            </div>
          )}
        </div>
        <h3 className="mt-6 mb-2 line-clamp-2 text-h2 text-ink group-hover:underline leading-tight break-keep wrap-break-words">
          {product.name}
        </h3>
        <div className="flex gap-1.5">
          <Badge>{product.dosage_form}</Badge>
          {childBadge && <Badge>{childBadge}</Badge>}
        </div>
      </Link>
      <div className="mt-auto flex justify-between items-center text-body-lg">
        <button
          type="button"
          disabled={soldOut}
          className="group relative inline-flex h-10 items-center gap-2 pl-3 pr-4 text-label font-medium uppercase tracking-wider text-ink disabled:cursor-not-allowed disabled:text-disabled cursor-pointer"
        >
          {/* 뒤에 깔리는 동그라미 → hover 시 늘어남 */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-10 rounded-full bg-sub transition-all duration-300 ease-out group-hover:w-full group-disabled:hidden"
          />
          <ArrowRight className="relative size-4" strokeWidth={1.5} aria-hidden />
          <span className="relative">{soldOut ? 'Sold out' : 'Add to cart'}</span>
        </button>
        <p className="font-normal text-ink">{product.price.toLocaleString('ko-KR')}원</p>
      </div>
    </article>
  );
}

// 바뀌는 것 : 이미지, 상품명, 가격, 제형, 어린이 여부, 품절 여부, DUR배지
// 고정 : 카드 구조, 여백, 담기 버튼 모양, 배지 위치

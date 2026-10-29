import Container from '@/src/components/layout/Container';
import DrugInfo from '@/src/components/product/detail/DrugInfo';
import DurNotice from '@/src/components/product/detail/DurNotice';
import HealthFoodInfo from '@/src/components/product/detail/HealthFoodInfo';
import PurchaseBar from '@/src/components/product/detail/PurchaseBar';
import ProductImage from '@/src/components/product/ProductImage';
import Badge from '@/src/components/ui/Badge';
import Breadcrumb from '@/src/lib/products/Breadcrumb';
import { childBadgeLabel } from '@/src/lib/products/child-age';
import { buildCrumbs } from '@/src/lib/products/crumbs';
import { getProductByCode, resolveCategory } from '@/src/lib/products/queries';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type ProductDetailPageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: ProductDetailPageProps): Promise<Metadata> {
  const { code } = await params;
  const product = await getProductByCode(code);
  return { title: product ? product.name : '상품을 찾을 수 없어요' };
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { code } = await params;
  const product = await getProductByCode(code);
  if (!product) notFound();

  const childBadge = childBadgeLabel(product.child_min_age_months, product.is_kids_product);

  const drug = product.medications;
  const food = product.health_foods;

  const companyLabel = drug ? '제조사' : '제조원';
  const company = drug ? drug.company : food?.company;

  // ① slug로 카테고리 + 부모 정보 가져오기
  const resolved = product.categories ? await resolveCategory(product.categories.slug) : null;
  // ② 그걸로 브레드크럼 만들기
  const crumbs = buildCrumbs(resolved?.category ?? null, { linkCurrent: true });

  return (
    <>
      <Container className="flex flex-col gap-6 pt-10 pb-40 lg:pb-0">
        <Breadcrumb items={crumbs} />
        <section className="flex flex-col gap-6 md:flex-row md:gap-10">
          <ProductImage
            imageKey={product.image_key}
            name={product.name}
            className="w-full shrink-0 md:w-1/2 lg:max-w-lg"
            sizes="(min-width: 1024px) 512px, (min-width: 768px) 50vw, 100vw"
            aspect="aspect-square"
          />
          <div className="flex flex-1 flex-col gap-2">
            {company && (
              <p className="text-sm text-muted">
                {companyLabel} · {company}
              </p>
            )}
            <h1 className="text-h2 font-semibold">{product.name}</h1>
            <div className="flex gap-1">
              <Badge>{product.dosage_form}</Badge>
              {childBadge && <Badge>{childBadge}</Badge>}
            </div>
            <p className="text-xl font-bold">{product.price.toLocaleString()}원</p>
            {drug ? (
              <DurNotice />
            ) : (
              <p className="text-[13px] text-muted">
                건강기능식품은 복용 중인 약과 함께 먹을 때 주의할 점을 확인해 드리지 않아요. <br />
                드시는 약이 있다면 약사와 먼저 상담해 주세요.
              </p>
            )}
            <PurchaseBar stock={product.stock} price={product.price} />
          </div>
        </section>
        <section className="mt-5 mb-10">
          <div
            aria-hidden
            className="relative mt-4 mb-12 h-px bg-linear-to-r from-transparent via-sub/60 to-transparent"
          >
            <span className="absolute top-0 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r-[1.9px] border-b-[1.9px] border-primary/60 bg-white" />
          </div>
          {drug && <DrugInfo drug={drug} code={product.code} />}
          {food && <HealthFoodInfo food={food} code={product.code} />}
        </section>
      </Container>
    </>
  );
}

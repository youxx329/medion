import Container from '@/src/components/layout/Container';
import DurNotice from '@/src/components/product/detail/DurNotice';
import PurchaseBar from '@/src/components/product/detail/PurchaseBar';
import ProductImage from '@/src/components/product/ProductImage';
import Badge from '@/src/components/ui/Badge';
import Breadcrumb from '@/src/lib/products/Breadcrumb';
import { childBadgeLabel } from '@/src/lib/products/child-age';
import { buildCrumbs } from '@/src/lib/products/crumbs';
import { getProductByCode, resolveCategory } from '@/src/lib/products/queries';
import Image from 'next/image';
import { notFound } from 'next/navigation';

export default async function ProductDetailPage({ params }: { params: Promise<{ code: string }> }) {
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
            {drug && <DurNotice />}
            <PurchaseBar stock={product.stock} price={product.price} />
          </div>
        </section>
        {product.medications?.pill_image_url && (
          <div className="relative aspect-2/1 w-full max-w-xs">
            <Image
              src={product.medications.pill_image_url}
              alt="알약 모양"
              fill
              sizes="320px"
              className="object-contain"
            />
          </div>
        )}
      </Container>
    </>
  );
}

import { getProductByCode } from '@/src/lib/products/queries';
import { notFound } from 'next/navigation';

export default async function ProductDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const product = await getProductByCode(code);

  if (!product) notFound();

  return (
    <>
      {product.medications?.pill_image_url && (
        <img src={product.medications.pill_image_url} alt="알약 모양" width={200} />
      )}
      <pre>{JSON.stringify(product, null, 2)}</pre>
    </>
  );
}

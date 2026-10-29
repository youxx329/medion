import Image from 'next/image';

type ProductImageProps = {
  imageKey: string;
  name: string;
  sizes?: string;
  className?: string;
  aspect?: string; // 추가
};

export default function ProductImage({
  imageKey,
  name,
  sizes = '(min-width: 768px) 33vw, 50vw',
  className,
  aspect = 'aspect-[3/4]',
}: ProductImageProps) {
  return (
    <div
      className={`relative ${aspect} overflow-hidden rounded-lg bg-product-bg ${className ?? ''}`}
    >
      <Image
        src={`/images/products/${imageKey}.webp`}
        alt={name}
        fill
        sizes={sizes}
        className="object-contain p-12 drop-shadow-xl"
      />
    </div>
  );
}

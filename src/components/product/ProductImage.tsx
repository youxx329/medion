import Image from 'next/image';

type ProductImageProps = {
  imageKey: string;
  name: string;
  sizes?: string;
  className?: string;
};

export default function ProductImage({
  imageKey,
  name,
  sizes = '(min-width: 768px) 33vw, 50vw',
  className,
}: ProductImageProps) {
  return (
    <div className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-product-bg ${className}`}>
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

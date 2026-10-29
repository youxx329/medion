import { type ProductDetail } from '@/src/lib/products/queries';
import AiConsultLink from './AiConsultLink';
import InfoAccordion from './InfoAccordion';
import InfoSection from './InfoSection';

type Food = NonNullable<ProductDetail['health_foods']>;

type HealthFoodInfoProps = {
  food: Food;
  code: string;
};

const ICON = '/images/icons/pills.svg'; // ← DrugInfo랑 같은 경로

export default function HealthFoodInfo({ food, code }: HealthFoodInfoProps) {
  const storage = [food.storage, food.shelf_life && `유통기한: ${food.shelf_life}`]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="flex flex-col gap-10">
      <InfoSection icon={ICON} title="이런 기능이 있어요" body={food.functionality} />
      <InfoSection icon={ICON} title="이렇게 드세요" body={food.intake_method} />
      <InfoSection icon={ICON} title="드시기 전 확인하세요" body={food.intake_caution} />

      <div>
        <InfoAccordion icon={ICON} title="보관 방법" body={storage} />
      </div>

      <AiConsultLink code={code} isDrug={false} />

      <div className="flex flex-col gap-1.5 text-xs text-muted">
        <p>본 제품은 질병의 예방 및 치료를 위한 의약품이 아닙니다.</p>
        <p>건강기능식품 정보 출처: 식품의약품안전처 건강기능식품 정보</p>
      </div>
    </div>
  );
}

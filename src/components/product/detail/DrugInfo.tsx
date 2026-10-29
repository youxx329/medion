import { type ProductDetail } from '@/src/lib/products/queries';
import { formatIngredient } from '@/src/lib/products/units';
import Image from 'next/image';
import AiConsultLink from './AiConsultLink';
import InfoAccordion from './InfoAccordion';
import InfoSection from './InfoSection';

type Drug = NonNullable<ProductDetail['medications']>; // ① 의약품 정보 한 덩어리의 모양

type DrugInfoProps = {
  // ② DrugInfo가 받는 props 목록
  drug: Drug; // ← ①을 여기서 써
  code: string;
};

const ICON = '/images/icons/pills.svg'; // ← 실제 파일 이름으로

export default function DrugInfo({ drug, code }: DrugInfoProps) {
  // tamt_seq('1', '2'...)별로 성분 묶기
  const groups = new Map<string, Drug['medication_ingredients']>();
  for (const ing of drug.medication_ingredients) {
    const list = groups.get(ing.tamt_seq) ?? [];
    if (!list.some((x) => x.raw_name === ing.raw_name)) list.push(ing);
    groups.set(ing.tamt_seq, list);
  }

  return (
    <div className="flex flex-col gap-10">
      <InfoSection icon={ICON} title="이 약의 효능" body={drug.efficacy} />
      <InfoSection icon={ICON} title="이렇게 복용하세요" body={drug.usage_info} />
      <InfoSection icon={ICON} title="복용 전 꼭 확인하세요" body={drug.warning} />

      {groups.size > 0 && (
        <InfoSection icon={ICON} title="성분">
          <div className="flex flex-col gap-4">
            {[...groups.entries()].map(([seq, items]) => (
              <div key={seq} className="flex flex-col gap-2">
                <ul className="flex flex-wrap gap-1.5">
                  {items.map((ing) => (
                    <li
                      key={ing.raw_name}
                      className="rounded-sm bg-surface px-2.5 py-1.5 text-sm text-ink"
                    >
                      {formatIngredient(ing.raw_name, ing.amount, ing.unit)}
                    </li>
                  ))}
                </ul>
                {items[0].amount_basis && (
                  <p className="text-[13px] text-muted">{items[0].amount_basis}</p>
                )}
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {drug.pill_image_url && (
        <InfoSection icon={ICON} title="알약 모양">
          <Image
            src={drug.pill_image_url}
            alt="알약 모양"
            width={640}
            height={320}
            sizes="320px"
            className="h-auto w-full max-w-xs rounded-sm"
          />
        </InfoSection>
      )}

      <div className="">
        <InfoAccordion icon={ICON} title="사용상 주의사항" body={drug.precaution} />
        <InfoAccordion icon={ICON} title="함께 주의할 약·음식" body={drug.interaction} />
        <InfoAccordion icon={ICON} title="나타날 수 있는 이상반응" body={drug.side_effect} />
        <InfoAccordion icon={ICON} title="보관 방법" body={drug.storage} />
      </div>

      <AiConsultLink code={code} isDrug />

      <p className="text-xs text-muted">
        의약품 정보 출처: 식품의약품안전처 의약품개요정보(e약은요)
      </p>
    </div>
  );
}

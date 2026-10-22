/** 이 나이(개월) 미만부터 복용 가능하면 어린이 상품으로 본다 (만 12세) */
export const CHILD_AGE_LIMIT_MONTHS = 144;

/**
 * 배지 문구.
 * - 0 → "0세+" (허가사항에 하한이 없는 경우)
 * - 24개월 미만 → "6개월+"
 * - 그 이상 → "2세+". 올림해서 실제보다 어린 나이로 보이지 않게 한다 (30개월 → 3세+)
 */
export function formatChildAge(months: number): string {
  if (months === 0) return '0세+';
  return months < 24 ? `${months}개월+` : `${Math.ceil(months / 12)}세+`;
}

/** 어린이 배지·필터 대상인지 */
export const isChildProduct = (months: number | null) =>
  months !== null && months < CHILD_AGE_LIMIT_MONTHS;

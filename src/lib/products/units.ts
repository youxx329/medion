const UNIT_LABELS: Record<string, string> = {
  밀리그램: 'mg',
  그램: 'g',
  마이크로그램: 'μg',
  '아이.유': 'IU',
  유니트: '단위',
  밀리리터: 'mL',
  '분류되지 않는 함량단위': '',
};

/** 아세트아미노펜 325mg / 함량 없으면 이름만 */
export function formatIngredient(name: string, amount: number | null, unit: string) {
  if (amount === null) return name;
  const label = UNIT_LABELS[unit] ?? unit; // 표에 없으면 원문 그대로
  return `${name} ${amount.toLocaleString()}${label}`;
}

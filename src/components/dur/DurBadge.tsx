import type { DurLevel } from '@/src/types/dur';
import Badge from '../ui/Badge';

/** 배지로 표시하는 단계. safe·info는 배지 없이 상세 안내에서만 */
export type DurBadgeLevel = Extract<DurLevel, 'danger' | 'warning'>;

const label: Record<DurBadgeLevel, string> = {
  danger: '금기',
  warning: '주의',
};

type DurBadgeProps = {
  level: DurBadgeLevel;
};

export default function DurBadge({ level }: DurBadgeProps) {
  return <Badge tone={level}>{label[level]}</Badge>;
}

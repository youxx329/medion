import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Item = {
  STTEMNT_NO: string;
  PRDUCT: string;
  ENTRPS: string | null;
  SRV_USE: string | null;
  MAIN_FNCTN: string | null;
};

const keyword = process.argv[2];
if (!keyword) {
  console.log('사용법: npx tsx supabase/scripts/list-health-foods.ts 엽산');
  process.exit(1);
}

const items = JSON.parse(
  readFileSync(join('supabase/data/health-foods', `${keyword}.json`), 'utf-8')
) as Item[];

items.forEach((it, i) => {
  const name = (it.PRDUCT ?? '').trim();
  const raw = (it.SRV_USE ?? '').includes('원료로 사용') ? '  [원료]' : '';
  console.log(`${String(i).padStart(2)}. ${name}${raw}`);
  console.log(`    ${it.ENTRPS}`);
  console.log(`    ${(it.MAIN_FNCTN ?? '').slice(0, 60)}`);
  console.log(`    ${it.STTEMNT_NO}\n`);
});

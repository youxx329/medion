import { readFileSync } from 'node:fs';

type Row = {
  item_seq: string;
  name: string;
  etc_otc_code: string | null;
  material_name: string;
};

const KEYWORD = process.argv[2] ?? '이부프로펜';

const rows = JSON.parse(readFileSync('supabase/data/material-names.json', 'utf-8')) as Row[];

const hit = rows.filter((r) => r.material_name.includes(KEYWORD));
const otc = hit.filter((r) => r.etc_otc_code === '일반의약품');

console.log(`"${KEYWORD}" 포함 ${hit.length}건 (일반약 ${otc.length}건)\n`);
for (const r of otc.slice(0, 15)) {
  console.log(`${r.name}\n  ${r.material_name}\n`);
}

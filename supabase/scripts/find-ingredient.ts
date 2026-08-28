import { readFileSync } from 'node:fs';

type Row = {
  item_seq: string;
  name: string;
  etc_otc_code: string | null;
  material_name: string;
};

const MODE = process.argv[2]; // 'name' 또는 'material'
const KEYWORD = process.argv[3];

if (!MODE || !KEYWORD) {
  console.log('사용법: npx tsx find-ingredient.ts name 이가탄');
  console.log('        npx tsx find-ingredient.ts material 이부프로펜');
  process.exit(1);
}

const rows = JSON.parse(readFileSync('supabase/data/material-names.json', 'utf-8')) as Row[];

const hit = rows.filter((r) =>
  MODE === 'name' ? r.name.includes(KEYWORD) : r.material_name.includes(KEYWORD)
);

console.log(`"${KEYWORD}" ${hit.length}건\n`);
for (const r of hit.slice(0, 20)) {
  console.log(`${r.name}`);
  console.log(`  ${r.material_name}\n`);
}

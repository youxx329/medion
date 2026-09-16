// supabase/scripts/find-stmt-no.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/data/health-foods';
const targets = process.argv.slice(2);

const all: { PRDUCT: string; STTEMNT_NO: string; ENTRPS: string }[] = [];

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json')) continue;
  const items = JSON.parse(readFileSync(join(DIR, f), 'utf-8'));
  all.push(...items);
}

for (const t of targets) {
  const hits = all.filter((it) =>
    (it.PRDUCT ?? '').replace(/\s/g, '').includes(t.replace(/\s/g, ''))
  );
  console.log(`\n=== ${t} ===`);
  if (hits.length === 0) {
    console.log('  없음');
    continue;
  }
  // 중복 제거
  const seen = new Set<string>();
  for (const h of hits) {
    if (seen.has(h.STTEMNT_NO)) continue;
    seen.add(h.STTEMNT_NO);
    console.log(`  ${h.STTEMNT_NO}  ${h.PRDUCT.trim()}  (${h.ENTRPS})`);
  }
}

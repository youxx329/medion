import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase/data/dur-items');

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
  const dist = new Map<string, number>();
  const seq = new Set<string>();

  for (const f of files) {
    const items = JSON.parse(await readFile(join(DIR, f), 'utf-8')) as {
      ITEM_SEQ: string;
      ETC_OTC_CODE: string | null;
    }[];

    for (const it of items) {
      if (seq.has(it.ITEM_SEQ)) continue;
      seq.add(it.ITEM_SEQ);
      const k = it.ETC_OTC_CODE ?? '(null)';
      dist.set(k, (dist.get(k) ?? 0) + 1);
    }
  }

  console.log(`유니크 품목 ${seq.size}건`);
  for (const [k, v] of dist) console.log(`  ${k}: ${v}`);
}

main();

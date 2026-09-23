/**
 * supabase/data/health-foods/*.json → health_foods 적재
 *
 * 실행: npm run load:health-foods
 * 선행: npm run fetch:hf (검색어를 바꿔가며 여러 번 실행한 결과가 폴더에 쌓여 있다)
 *
 * ────────────────────────────────────────────────
 * 폴더의 모든 JSON 을 넣는다
 * ────────────────────────────────────────────────
 * 검색어별로 파일이 나뉘고 같은 제품이 여러 파일에 중복으로 나온다.
 * STTEMNT_NO(품목제조신고번호) 기준으로 합친 뒤 upsert 한다.
 *
 * 선정 상품(products-selected.csv)만 골라 넣지 않는 이유:
 * 나중에 상품을 추가할 때 수집 파일에 이미 있는 제품을 다시 받을 필요가 없다.
 *
 * ────────────────────────────────────────────────
 * 필드 매핑
 * ────────────────────────────────────────────────
 * STTEMNT_NO → sttemnt_no   PRDUCT       → name
 * ENTRPS     → company      REGIST_DT    → registered_at
 * DISTB_PD   → shelf_life   SUNGSANG     → appearance
 * SRV_USE    → intake_method PRSRV_PD    → storage
 * INTAKE_HINT1 → intake_caution  MAIN_FNCTN → functionality
 * BASE_STANDARD → base_standard
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = join(process.cwd(), 'supabase/data/health-foods');
const PRODUCTS_CSV = join(process.cwd(), 'supabase/data/products-selected.csv');
const BATCH_SIZE = 500;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type RawItem = {
  STTEMNT_NO: string;
  PRDUCT: string;
  ENTRPS: string | null;
  REGIST_DT: string | null;
  DISTB_PD: string | null;
  SUNGSANG: string | null;
  SRV_USE: string | null;
  PRSRV_PD: string | null;
  INTAKE_HINT1: string | null;
  MAIN_FNCTN: string | null;
  BASE_STANDARD: string | null;
};

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** items[].item 중첩을 벗긴다. 중첩이 없는 형태도 받아들인다 */
function unwrap(raw: unknown[]): RawItem[] {
  return raw.map((r) => {
    const obj = r as Record<string, unknown>;
    return (obj?.item ?? obj) as RawItem;
  });
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (c === ',' && !inQuotes) {
      fields.push(field);
      field = '';
      continue;
    }
    field += c;
  }
  fields.push(field);
  return fields;
}

/** 선정 상품 중 건기식의 신고번호. 적재 후 전부 들어갔는지 확인용 */
async function selectedNumbers(): Promise<Map<string, string>> {
  const text = await readFile(PRODUCTS_CSV, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((c) => c.trim());
  const iSource = header.indexOf('출처');
  const iName = header.indexOf('제품명');
  const iId = header.indexOf('식별자');

  const map = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    if (f.length !== header.length) continue;
    if (f[iSource].trim() === 'medications') continue;
    const id = f[iId].trim();
    if (id !== '') map.set(id, f[iName].trim());
  }
  return map;
}

async function main() {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error(`${DATA_DIR} 에 JSON 이 없습니다. 먼저 npm run fetch:hf`);
    process.exit(1);
  }

  // 같은 제품이 검색어마다 나오므로 신고번호로 합친다
  const picked = new Map<string, RawItem>();
  const conflicts: string[] = [];
  let total = 0;

  for (const file of files) {
    const items = unwrap(JSON.parse(await readFile(join(DATA_DIR, file), 'utf-8')) as unknown[]);
    total += items.length;

    for (const item of items) {
      const no = clean(item.STTEMNT_NO);
      if (no === null) continue;

      const prev = picked.get(no);
      if (prev === undefined) {
        picked.set(no, item);
        continue;
      }
      // 같은 신고번호인데 제품명이 다르면 어느 쪽을 믿을지 판단이 필요하다
      if (clean(prev.PRDUCT) !== clean(item.PRDUCT)) {
        conflicts.push(`${no}: "${prev.PRDUCT}" vs "${item.PRDUCT}"`);
      }
    }
  }

  console.log(`파일 ${files.length}개 / 원본 ${total}건 → 유니크 ${picked.size}건`);
  if (conflicts.length > 0) {
    console.log(`\n⚠️ 같은 신고번호인데 제품명이 다름 ${conflicts.length}건 (먼저 읽은 값 유지)`);
    conflicts.slice(0, 5).forEach((c) => console.log(`   ${c}`));
  }

  const rows = [...picked.values()].map((r) => ({
    sttemnt_no: clean(r.STTEMNT_NO)!,
    name: clean(r.PRDUCT) ?? '',
    company: clean(r.ENTRPS),
    registered_at: clean(r.REGIST_DT),
    shelf_life: clean(r.DISTB_PD),
    appearance: clean(r.SUNGSANG),
    intake_method: clean(r.SRV_USE),
    storage: clean(r.PRSRV_PD),
    intake_caution: clean(r.INTAKE_HINT1),
    functionality: clean(r.MAIN_FNCTN),
    base_standard: clean(r.BASE_STANDARD),
  }));

  // name 은 not null 이다. 비어 있으면 필드명을 잘못 읽고 있는 것이다
  const nameless = rows.filter((r) => r.name === '');
  if (nameless.length > 0) {
    console.error(`❌ 제품명이 비어있는 건 ${nameless.length}건. 필드명 매핑을 확인하세요.`);
    console.error(
      `   예: ${nameless
        .slice(0, 5)
        .map((r) => r.sttemnt_no)
        .join(', ')}`
    );
    process.exit(1);
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('health_foods')
      .upsert(batch, { onConflict: 'sttemnt_no' });
    if (error) {
      console.error(`  ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  // 선정 상품이 전부 들어갔는지 확인. 빠지면 #15 seed 가 그 상품을 못 만든다
  const selected = await selectedNumbers();
  const missing = [...selected].filter(([no]) => !picked.has(no));

  console.log(`\n적재 ${rows.length}건 / 선정 건기식 ${selected.size}건`);
  if (missing.length > 0) {
    console.error(`\n❌ 선정 상품인데 수집 데이터에 없는 건기식 ${missing.length}건`);
    missing.forEach(([no, name]) => console.error(`   ${no}  ${name}`));
    console.error('   해당 제품명으로 fetch:hf 를 다시 실행해야 합니다.');
    process.exit(1);
  }
  console.log('선정 건기식 전부 확인');
}

main();

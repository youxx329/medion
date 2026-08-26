/**
 * supabase/data/dur-items/*.json
 *   → medications.etc_otc_code UPDATE
 *   → supabase/data/material-names.json 저장 (다음 단계 재료)
 *
 * 실행: npm run load:dur-items
 *
 * ────────────────────────────────────────────────
 * DB 에 넣지 않는 것
 * ────────────────────────────────────────────────
 * 23,486건 중 우리 DB(e약은요 4,745건)에 있는 품목만 쓸모가 있다.
 * 나머지는 판매 후보가 아니므로 저장할 이유가 없다.
 * MATERIAL_NAME 도 테이블로 만들지 않는다. 상품 선정과 성분 매핑에만 쓰이고
 * 그 결과물인 medication_ingredients 가 남으면 원본은 필요 없다.
 *
 * ────────────────────────────────────────────────
 * UPDATE 를 upsert 로 하는 이유
 * ────────────────────────────────────────────────
 * 4,745번 .update().eq() 를 호출하면 왕복이 4,745번이다.
 * upsert 는 배치로 보낼 수 있지만 insert 가 성립해야 하므로
 * not null 컬럼(name)을 함께 실어야 한다. DB 에서 읽은 값을 그대로
 * 되돌려 보내므로 실제로 바뀌는 값은 etc_otc_code 뿐이다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../../src/types/database.types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = join(process.cwd(), 'supabase/data/dur-items');
const MATERIAL_OUT = join(process.cwd(), 'supabase/data/material-names.json');
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

/**
 * DUR품목정보 응답 1건.
 * ★ TYPE_NAME 은 필드명 끝에 공백이 2칸 붙어 있다. 식약처 쪽 오타지만
 *   raw['TYPE_NAME'] 로 접근하면 undefined 가 나온다.
 */
type RawItem = {
  ITEM_SEQ: string;
  ITEM_NAME: string;
  ETC_OTC_CODE: string | null;
  MATERIAL_NAME: string | null;
  CANCEL_NAME: string | null; // 정상 / (취소 관련 값)
  CANCEL_DATE: string | null;
  TYPE_CODE: string | null;
  'TYPE_NAME  ': string | null;
};

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** medications 에 이미 있는 item_seq → name. 이 목록에 없는 품목은 버린다. */
async function loadExisting(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('medications')
      .select('item_seq, name')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('medications 조회 실패:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) map.set(row.item_seq, row.name);
    if (data.length < PAGE_SIZE) break;
  }

  return map;
}

async function main() {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort();

  if (files.length === 0) {
    console.error(`${DATA_DIR} 에 JSON 이 없습니다. 먼저 npm run fetch:dur-items`);
    process.exit(1);
  }

  const existing = await loadExisting();
  console.log(`medications ${existing.size}건 로드`);

  // ITEM_SEQ 별로 하나만 남긴다.
  // 같은 품목이 DUR 타입마다 한 행씩 나오므로 중복이 대량 발생한다.
  const picked = new Map<
    string,
    { etcOtc: string | null; material: string | null; cancel: string | null }
  >();

  let total = 0;
  let outOfScope = 0; // e약은요에 없는 품목
  const conflicts: string[] = []; // 같은 ITEM_SEQ 인데 ETC_OTC_CODE 가 다른 경우
  const cancelDist = new Map<string, number>();
  const typeDist = new Map<string, number>();

  for (const file of files) {
    const items = JSON.parse(await readFile(join(DATA_DIR, file), 'utf-8')) as RawItem[];

    for (const raw of items) {
      total++;

      const typeName = clean(raw['TYPE_NAME  ']) ?? '(없음)';
      typeDist.set(typeName, (typeDist.get(typeName) ?? 0) + 1);

      const itemSeq = clean(raw.ITEM_SEQ);
      if (!itemSeq) continue;

      if (!existing.has(itemSeq)) {
        outOfScope++;
        continue;
      }

      const etcOtc = clean(raw.ETC_OTC_CODE);
      const cancel = clean(raw.CANCEL_NAME) ?? '(없음)';
      cancelDist.set(cancel, (cancelDist.get(cancel) ?? 0) + 1);

      const prev = picked.get(itemSeq);

      // 중복 행끼리 값이 다르면 어느 쪽을 믿을지 판단이 필요하다.
      // 지금은 먼저 나온 값을 유지하고 목록만 남긴다.
      if (prev) {
        if (prev.etcOtc !== etcOtc) conflicts.push(itemSeq);
        continue;
      }

      picked.set(itemSeq, {
        etcOtc,
        material: clean(raw.MATERIAL_NAME),
        cancel: clean(raw.CANCEL_NAME),
      });
    }
  }

  console.log(`\n원본 ${total}행`);
  console.log(`  e약은요에 없는 품목 ${outOfScope}행 제외`);
  console.log(`  유니크 품목 ${picked.size}건 (medications ${existing.size}건 중)`);
  console.log(`  → 매칭 실패 ${existing.size - picked.size}건은 etc_otc_code 가 null 로 남는다`);

  if (conflicts.length > 0) {
    console.log(`\n⚠️ 같은 ITEM_SEQ 인데 ETC_OTC_CODE 가 다른 품목 ${conflicts.length}건`);
    console.log(`   예: ${conflicts.slice(0, 5).join(', ')}`);
  }

  console.log('\nTYPE_NAME 분포 (전체 원본 기준)');
  for (const [k, v] of [...typeDist].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\nCANCEL_NAME 분포 (우리 품목 기준)');
  for (const [k, v] of [...cancelDist].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  // ── etc_otc_code UPDATE ─────────────────────────
  const rows = [...picked.entries()]
    .filter(([, v]) => v.etcOtc !== null)
    .map(([itemSeq, v]) => ({
      item_seq: itemSeq,
      name: existing.get(itemSeq)!, // not null 이라 함께 보내야 한다. 값은 그대로
      etc_otc_code: v.etcOtc,
    }));

  console.log(`\netc_otc_code 적재 ${rows.length}건`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('medications').upsert(batch, { onConflict: 'item_seq' });

    if (error) {
      console.error(`  ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  // ── MATERIAL_NAME 파일 저장 ──────────────────────
  // 다음 단계(판매 상품 선정 + 성분 매핑)에서 텍스트 검색으로 쓴다.
  // DB 에 넣지 않는 이유는 파일 상단 주석 참고.
  const materials = [...picked.entries()]
    .filter(([, v]) => v.material !== null)
    .map(([itemSeq, v]) => ({
      item_seq: itemSeq,
      name: existing.get(itemSeq)!,
      etc_otc_code: v.etcOtc,
      cancel_name: v.cancel,
      material_name: v.material,
    }));

  await writeFile(MATERIAL_OUT, JSON.stringify(materials, null, 2), 'utf-8');
  console.log(`\nMATERIAL_NAME ${materials.length}건 → ${MATERIAL_OUT}`);

  const { count } = await supabase
    .from('medications')
    .select('*', { count: 'exact', head: true })
    .is('etc_otc_code', null);

  console.log(`\n완료. etc_otc_code 가 null 인 품목 ${count}건`);
  console.log('이 품목들은 성분 정보를 얻을 수 없으므로 판매 후보에서 제외한다.');
}

main();

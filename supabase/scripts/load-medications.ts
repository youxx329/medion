/**
 * supabase/data/medications/*.json → medications 테이블 적재
 *
 * 실행: npm run load:meds
 *
 * item_seq 로 upsert 하므로 몇 번을 돌려도 결과가 같다(멱등성).
 * API 를 다시 호출하지 않으므로 매핑을 고쳐도 부담 없이 재실행할 수 있다.
 *
 * ※ etc_otc_code 는 e약은요에 없다. DUR품목정보 적재(#13)에서 채운다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../../src/types/database.types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = join(process.cwd(), 'supabase/data/medications');
const BATCH_SIZE = 500;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

// service_role 키는 RLS 를 우회한다. medications 는 public read 정책만 있어서
// anon 키로는 쓰기가 막힌다.
const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

type MedicationInsert = Database['public']['Tables']['medications']['Insert'];

/** e약은요 응답 1건 (원본 필드명) */
type RawMedication = {
  itemSeq: string;
  itemName: string;
  entpName: string | null;
  efcyQesitm: string | null;
  useMethodQesitm: string | null;
  atpnWarnQesitm: string | null;
  atpnQesitm: string | null;
  intrcQesitm: string | null;
  seQesitm: string | null;
  depositMethodQesitm: string | null;
  itemImage: string | null;
};

/**
 * 공공데이터 문자열 정리
 *   - 앞뒤 공백·개행 제거 (원문 끝에 \n 이 붙는 경우가 많다)
 *   - 빈 문자열은 null 로 (""와 null 이 섞여 오면 조회 조건이 지저분해진다)
 */
function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** API 필드명 → DB 컬럼명 */
function toRow(raw: RawMedication): MedicationInsert {
  return {
    item_seq: raw.itemSeq,
    name: raw.itemName,
    company: clean(raw.entpName),
    efficacy: clean(raw.efcyQesitm),
    usage_info: clean(raw.useMethodQesitm),
    warning: clean(raw.atpnWarnQesitm),
    precaution: clean(raw.atpnQesitm),
    interaction: clean(raw.intrcQesitm),
    side_effect: clean(raw.seQesitm),
    storage: clean(raw.depositMethodQesitm),
    pill_image_url: clean(raw.itemImage),
    // id / created_at / updated_at 은 DB 가 채운다
  };
}

async function main() {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort();

  if (files.length === 0) {
    console.error(`${DATA_DIR} 에 JSON 파일이 없습니다. 먼저 npm run fetch:meds`);
    process.exit(1);
  }

  console.log(`${files.length}개 파일 읽는 중...`);

  const rows: MedicationInsert[] = [];

  for (const file of files) {
    const text = await readFile(join(DATA_DIR, file), 'utf-8');
    const items = JSON.parse(text) as RawMedication[];

    if (items.length === 0) {
      console.warn(`${file} 이 비어 있습니다. 해당 페이지를 다시 받아야 할 수 있습니다.`);
      continue;
    }

    rows.push(...items.map(toRow));
  }

  // 같은 item_seq 가 여러 페이지에 걸쳐 나오면 upsert 가 한 번에 처리하지 못한다.
  // (하나의 요청 안에 중복 키가 있으면 Postgres 가 거부한다)
  const unique = new Map<string, MedicationInsert>();
  for (const row of rows) unique.set(row.item_seq, row);

  const duplicated = rows.length - unique.size;
  if (duplicated > 0) {
    console.log(`중복 item_seq ${duplicated}건 제거 (나중 값 사용)`);
  }

  const payload = [...unique.values()];
  console.log(`적재 대상 ${payload.length}건\n`);

  // 한 번에 다 보내면 요청이 너무 커서 실패한다. 나눠서 보낸다.
  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    const batch = payload.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from('medications').upsert(batch, { onConflict: 'item_seq' });

    if (error) {
      console.error(`${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }

    console.log(`${i + batch.length}/${payload.length}`);
  }

  const { count } = await supabase.from('medications').select('*', { count: 'exact', head: true });

  console.log(`\n완료. medications 테이블 ${count}건`);
}

main();

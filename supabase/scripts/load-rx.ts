/**
 * supabase/data/dur-items/*.json → medications 에 전문의약품 insert
 *
 * 실행: npm run load:rx
 * 선행: npm run fetch:dur-items (#13에서 이미 받아둔 파일을 재사용한다)
 *
 * ────────────────────────────────────────────────
 * 왜 필요한가
 * ────────────────────────────────────────────────
 * medications 는 e약은요로 채웠는데, e약은요는 일반의약품 위주 서비스라
 * 전문의약품이 7건뿐이다(전부 국소 외용제).
 *
 * user_medications(복용 중인 약) 검색이 medications 를 뒤지므로,
 * 전문약이 없으면 처방약을 등록할 수 없다.
 * 메토트렉세이트 → 이부프로펜 병용금기 시연이 첫 단계에서 막힌다.
 *
 * ────────────────────────────────────────────────
 * 왜 이 컬럼들만 채우는가
 * ────────────────────────────────────────────────
 * 이 약들은 검색·등록 전용이다. 판매 상품이 아니므로 상세 페이지가 없다.
 * 효능·부작용·이미지는 화면에 나올 일이 없어 null 로 둔다.
 *   item_seq / name / company / etc_otc_code
 *
 * ────────────────────────────────────────────────
 * 일반의약품은 넣지 않는다
 * ────────────────────────────────────────────────
 * DUR품목정보의 일반약 4,582건 중 1,947건이 e약은요에 없다.
 * 넣으면 판매 후보 풀이 늘어나지만, 효능·이미지가 없어 상세 페이지를
 * 채울 수 없다. "검색은 되는데 상세가 빈" 상품이 생긴다.
 * 판매 상품은 e약은요에 있는 2,628건 안에서 고른다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../../src/types/database.types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = join(process.cwd(), 'supabase/data/dur-items');
const BATCH_SIZE = 500;
const TARGET = '전문의약품';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

type MedicationInsert = Database['public']['Tables']['medications']['Insert'];

type RawItem = {
  ITEM_SEQ: string;
  ITEM_NAME: string;
  ENTP_NAME: string | null;
  ETC_OTC_CODE: string | null;
};

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

async function main() {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort();

  if (files.length === 0) {
    console.error(`${DATA_DIR} 에 JSON 이 없습니다. 먼저 npm run fetch:dur-items`);
    process.exit(1);
  }

  // ITEM_SEQ 는 품목당 1행이지만(#13에서 확인), 파일이 여러 개라
  // 안전하게 Map 으로 모은다.
  const picked = new Map<string, MedicationInsert>();
  let total = 0;
  let otc = 0;

  for (const file of files) {
    const items = JSON.parse(await readFile(join(DATA_DIR, file), 'utf-8')) as RawItem[];

    for (const raw of items) {
      total++;

      if (clean(raw.ETC_OTC_CODE) !== TARGET) {
        otc++;
        continue;
      }

      const itemSeq = clean(raw.ITEM_SEQ);
      if (!itemSeq) continue;

      picked.set(itemSeq, {
        item_seq: itemSeq,
        name: raw.ITEM_NAME,
        company: clean(raw.ENTP_NAME),
        etc_otc_code: TARGET,
        // efficacy 이하는 보내지 않는다.
        // upsert 는 보낸 컬럼만 갱신하므로, 이미 있는 7건(외용제)의
        // 효능·부작용이 null 로 덮이지 않는다.
      });
    }
  }

  console.log(`원본 ${total}행`);
  console.log(`  ${TARGET} 외 ${otc}행 제외`);
  console.log(`  적재 대상 ${picked.size}건\n`);

  const before = await countMedications();

  const payload = [...picked.values()];

  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    const batch = payload.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from('medications').upsert(batch, { onConflict: 'item_seq' });

    if (error) {
      console.error(`  ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }

    console.log(`  ${Math.min(i + BATCH_SIZE, payload.length)}/${payload.length}`);
  }

  const after = await countMedications();

  console.log(`\nmedications ${before} → ${after} (+${after - before})`);
  console.log('증가분이 적재 대상보다 적으면 이미 있던 품목이 그만큼 겹친 것이다.');

  // 시연 시나리오 선행 조건 확인
  const { data } = await supabase
    .from('medications')
    .select('item_seq, name, company')
    .ilike('name', '%메토트렉세이트%')
    .limit(5);

  console.log(`\n메토트렉세이트 검색 결과 ${data?.length ?? 0}건`);
  for (const row of data ?? []) console.log(`  ${row.name} / ${row.company}`);

  if (!data || data.length === 0) {
    console.log('  ⚠️ 제품명에 성분명이 없을 수 있다. material-names.json 에서 성분으로 찾을 것');
  }
}

async function countMedications() {
  const { count } = await supabase.from('medications').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

main();

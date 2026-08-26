/**
 * supabase/data/dur/** → ingredients / dur_interactions / dur_conditions 적재
 *
 * 실행: npm run load:dur
 * 선행: 마이그레이션(dur_conditions.remark, del_yn) 실행 + 타입 재생성
 *
 * ────────────────────────────────────────────────
 * 왜 한 스크립트에 3단계를 다 넣었나
 * ────────────────────────────────────────────────
 * API 는 성분을 코드(D000762)로 주는데 DB 는 uuid 를 요구한다.
 * 코드→uuid 맵은 ingredients 를 적재한 직후에만 만들 수 있으므로
 * 세 테이블의 순서가 강제된다. 파일을 쪼개면 그 순서를 사람이 기억해야 한다.
 *
 * ────────────────────────────────────────────────
 * 멱등성
 * ────────────────────────────────────────────────
 * ingredients        conflict: code
 * dur_interactions   conflict: (ingredient_a_id, ingredient_b_id)
 * dur_conditions     conflict: (dur_seq, condition_type)
 *
 * ────────────────────────────────────────────────
 * del_yn 을 필터하지 않고 저장하는 이유 ★
 * ────────────────────────────────────────────────
 * '정상'만 골라 넣으면, 나중에 그 고시가 폐지돼 '삭제'로 바뀌었을 때
 * upsert 가 그 행을 건드리지 않는다. DB 에는 계속 유효한 금기로 남는다.
 * 그대로 저장하고 조회 쿼리에서 제외해야 재적재만으로 상태가 갱신된다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../../src/types/database.types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_ROOT = join(process.cwd(), 'supabase/data/dur');
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000; // Supabase select 기본 최대 행 수

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

type IngredientInsert = Database['public']['Tables']['ingredients']['Insert'];
type InteractionInsert = Database['public']['Tables']['dur_interactions']['Insert'];
type ConditionInsert = Database['public']['Tables']['dur_conditions']['Insert'];

const CONDITION_DIRS = ['pregnancy', 'age', 'elderly'] as const;
type ConditionType = (typeof CONDITION_DIRS)[number];

/**
 * 병용금기 응답. A 쪽과 B 쪽이 MIXTURE_ 접두사만 다른 대칭 구조다.
 * ⚠️ MIXTURE_ 접두사 필드명은 A 쪽 구조에서 유추한 것이다.
 *    첫 실행 후 "성분코드 미발견" 카운트가 0 이 아니면 여기부터 의심할 것.
 */
type RawInteraction = {
  INGR_CODE: string;
  INGR_KOR_NAME: string;
  INGR_ENG_NAME?: string;
  ORI?: string;
  MIX_TYPE?: string;
  MIX?: string;
  MIXTURE_INGR_CODE: string;
  MIXTURE_INGR_KOR_NAME: string;
  MIXTURE_INGR_ENG_NAME?: string;
  MIXTURE_ORI?: string;
  MIXTURE_MIX_TYPE?: string;
  MIXTURE_MIX?: string;
  PROHBT_CONTENT?: string;
  REMARK?: string;
  DEL_YN?: string;
  NOTIFICATION_DATE?: string;
};

/**
 * 조건금기 3종 공통. 병용금기와 필드명이 다르다(INGR_NAME / ORI_INGR).
 * GRADE 는 임부만, AGE_BASE 는 연령만 존재한다.
 */
type RawCondition = {
  DUR_SEQ: string;
  INGR_CODE: string;
  INGR_NAME: string;
  INGR_ENG_NAME?: string;
  ORI_INGR?: string;
  GRADE?: string;
  AGE_BASE?: string;
  FORM_NAME?: string;
  PROHBT_CONTENT?: string;
  REMARK?: string;
  DEL_YN?: string;
  NOTIFICATION_DATE?: string;
};

/**
 * 공공데이터 문자열 정리.
 * 빈 문자열이 null 대신 오는 필드가 있다(FORM_NAME, CLASS_NAME).
 * 섞여 들어가면 조회 조건이 지저분해지므로 여기서 통일한다.
 */
function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** items[].item 중첩을 벗긴다. 중첩이 없는 형태도 받아들인다. */
function unwrap<T>(raw: unknown[]): T[] {
  return raw.map((r) => {
    const obj = r as Record<string, unknown>;
    return (obj?.item ?? obj) as T;
  });
}

async function readDir<T>(dir: string): Promise<T[]> {
  const path = join(DATA_ROOT, dir);
  const files = (await readdir(path)).filter((f) => f.endsWith('.json')).sort();

  if (files.length === 0) {
    throw new Error(`${path} 에 JSON 이 없습니다. 먼저 npm run fetch:dur`);
  }

  const out: T[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(path, file), 'utf-8')) as unknown[];
    out.push(...unwrap<T>(raw));
  }
  return out;
}

/**
 * 같은 성분코드가 4종 API 에 반복 등장하고, 어디서 왔느냐에 따라
 * 채워진 필드가 다르다. 나중 값으로 덮어쓰면 앞서 얻은 ori_names 가 날아간다.
 * 값이 있는 쪽을 살리는 방향으로 병합한다.
 */
function mergeIngredient(prev: IngredientInsert | undefined, next: IngredientInsert) {
  if (!prev) return next;
  return {
    code: next.code,
    name_ko: prev.name_ko || next.name_ko,
    name_en: prev.name_en ?? next.name_en,
    ori_names: prev.ori_names ?? next.ori_names,
  };
}

async function upsertInBatches<T>(table: string, rows: T[], onConflict: string) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table as never).upsert(batch as never, { onConflict });

    if (error) {
      console.error(`  ${table} ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
}

// ============================================================
// Phase 1. ingredients
// ============================================================
async function loadIngredients() {
  console.log('\n[1/3] ingredients');

  const map = new Map<string, IngredientInsert>();

  const put = (row: IngredientInsert | null) => {
    if (!row?.code) return;
    map.set(row.code, mergeIngredient(map.get(row.code), row));
  };

  // 병용금기는 A 쪽과 B 쪽 양쪽에서 성분이 나온다.
  // 한쪽만 훑으면 B 로만 등장하는 성분이 통째로 빠지고,
  // 그 성분의 금기는 Phase 2 에서 조용히 스킵된다.
  const interactions = await readDir<RawInteraction>('interaction');
  for (const r of interactions) {
    put({
      code: clean(r.INGR_CODE)!,
      name_ko: clean(r.INGR_KOR_NAME) ?? '',
      name_en: clean(r.INGR_ENG_NAME),
      ori_names: clean(r.ORI),
    });
    put({
      code: clean(r.MIXTURE_INGR_CODE)!,
      name_ko: clean(r.MIXTURE_INGR_KOR_NAME) ?? '',
      name_en: clean(r.MIXTURE_INGR_ENG_NAME),
      ori_names: clean(r.MIXTURE_ORI),
    });
  }

  for (const dir of CONDITION_DIRS) {
    const rows = await readDir<RawCondition>(dir);
    for (const r of rows) {
      put({
        code: clean(r.INGR_CODE)!,
        name_ko: clean(r.INGR_NAME) ?? '',
        name_en: clean(r.INGR_ENG_NAME),
        ori_names: clean(r.ORI_INGR),
      });
    }
  }

  // name_ko 는 not null 이다. 빈 값이 있으면 필드명을 잘못 읽고 있는 것이다.
  const nameless = [...map.values()].filter((r) => !r.name_ko);
  if (nameless.length > 0) {
    console.error(`  성분명이 비어있는 코드 ${nameless.length}건. 필드명 매핑을 확인하세요.`);
    console.error(
      `  예: ${nameless
        .slice(0, 5)
        .map((r) => r.code)
        .join(', ')}`
    );
    process.exit(1);
  }

  const rows = [...map.values()];
  console.log(`  유니크 성분 ${rows.length}건`);
  await upsertInBatches('ingredients', rows, 'code');
}

// ============================================================
// Phase 2. 코드 → uuid 맵
// ============================================================
async function buildCodeMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // select 는 기본 1,000행에서 잘린다. 성분이 그보다 많으므로 페이징한다.
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, code')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('ingredients 조회 실패:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) map.set(row.code, row.id);
    if (data.length < PAGE_SIZE) break;
  }

  console.log(`\n코드→uuid 맵 ${map.size}건`);
  return map;
}

// ============================================================
// Phase 3. dur_interactions
// ============================================================
async function loadInteractions(codeMap: Map<string, string>) {
  console.log('\n[2/3] dur_interactions');

  const raw = await readDir<RawInteraction>('interaction');
  const map = new Map<string, InteractionInsert>();

  let missing = 0;
  let selfPair = 0;
  let swapped = 0;

  for (const r of raw) {
    const aId = codeMap.get(clean(r.INGR_CODE) ?? '');
    const bId = codeMap.get(clean(r.MIXTURE_INGR_CODE) ?? '');

    // Phase 1 에서 같은 파일로 성분을 뽑았으므로 0 이어야 한다.
    // 0 이 아니면 MIXTURE_ 필드명이 틀린 것이다.
    if (!aId || !bId) {
      missing++;
      continue;
    }
    if (aId === bId) {
      selfPair++;
      continue;
    }

    // A→B, B→A 가 모두 응답에 들어있다. unique(a,b) 로는 못 막으므로
    // 작은 uuid 를 A 로 고정한다.
    // ★ 스왑하면 mix_type / mix 도 같이 따라가야 한다. 여기서 어긋나면
    //   "복합" 표시가 반대쪽 성분에 붙는다.
    const flip = aId > bId;
    if (flip) swapped++;

    const row: InteractionInsert = {
      ingredient_a_id: flip ? bId : aId,
      ingredient_b_id: flip ? aId : bId,
      mix_type_a: clean(flip ? r.MIXTURE_MIX_TYPE : r.MIX_TYPE),
      mix_type_b: clean(flip ? r.MIX_TYPE : r.MIXTURE_MIX_TYPE),
      mix_a: clean(flip ? r.MIXTURE_MIX : r.MIX),
      mix_b: clean(flip ? r.MIX : r.MIXTURE_MIX),
      prohibit_content: clean(r.PROHBT_CONTENT),
      remark: clean(r.REMARK),
      del_yn: clean(r.DEL_YN),
      notification_date: clean(r.NOTIFICATION_DATE),
    };

    const key = `${row.ingredient_a_id}|${row.ingredient_b_id}`;
    map.set(key, row);
  }

  const collapsed = raw.length - map.size - missing - selfPair;

  if (missing > 0) console.error(`  ⚠️ 성분코드 미발견 ${missing}건 — 필드명 매핑 확인 필요`);
  if (selfPair > 0) console.log(`  자기 자신과의 쌍 ${selfPair}건 제외`);
  console.log(`  A/B 스왑 ${swapped}건`);
  console.log(`  중복 병합 ${collapsed}건 → 적재 대상 ${map.size}건`);

  // 병합된 건수가 원본의 절반 근처면 순수 양방향 중복이다.
  // 그보다 많으면 같은 성분쌍에 규칙이 여러 개 붙어있다는 뜻이고,
  // unique(a,b) 때문에 마지막 하나만 남는다. 그 경우 스키마를 다시 봐야 한다.
  console.log(
    `  (원본 ${raw.length}건 대비 병합률 ${((collapsed / raw.length) * 100).toFixed(1)}%)`
  );

  await upsertInBatches('dur_interactions', [...map.values()], 'ingredient_a_id,ingredient_b_id');
}

// ============================================================
// Phase 4. dur_conditions
// ============================================================
async function loadConditions(codeMap: Map<string, string>) {
  console.log('\n[3/3] dur_conditions');

  // (dur_seq, condition_type) 이 unique 다. 한 요청 안에 중복 키가 있으면
  // Postgres 가 배치 전체를 거부하므로 미리 합친다.
  const map = new Map<string, ConditionInsert>();
  let missing = 0;

  for (const dir of CONDITION_DIRS) {
    const rows = await readDir<RawCondition>(dir);
    const type: ConditionType = dir;
    let dirMissing = 0;

    for (const r of rows) {
      const ingredientId = codeMap.get(clean(r.INGR_CODE) ?? '');
      if (!ingredientId) {
        dirMissing++;
        continue;
      }

      const durSeq = clean(r.DUR_SEQ);
      if (!durSeq) continue;

      map.set(`${durSeq}|${type}`, {
        dur_seq: durSeq,
        ingredient_id: ingredientId,
        // condition_type 은 응답에 없다. 어느 폴더에서 읽었는지가 유일한 근거다.
        condition_type: type,
        condition_value: clean(r.AGE_BASE), // 연령금기만 값이 있다
        grade: clean(r.GRADE), // 임부금기만 값이 있다
        form_name: clean(r.FORM_NAME), // 노인주의는 빈 문자열 → null
        prohibit_content: clean(r.PROHBT_CONTENT),
        remark: clean(r.REMARK),
        del_yn: clean(r.DEL_YN),
        notification_date: clean(r.NOTIFICATION_DATE),
      });
    }

    missing += dirMissing;
    const warn = dirMissing > 0 ? `  ⚠️ 성분 미발견 ${dirMissing}건` : '';
    console.log(`  ${dir}: ${rows.length}건 읽음${warn}`);
  }

  if (missing > 0) {
    console.error(`  ⚠️ 성분코드 미발견 총 ${missing}건 — 이 금기는 영원히 검사되지 않는다`);
  }

  console.log(`  적재 대상 ${map.size}건`);
  await upsertInBatches('dur_conditions', [...map.values()], 'dur_seq,condition_type');
}

// ============================================================
async function main() {
  await loadIngredients();
  const codeMap = await buildCodeMap();
  await loadInteractions(codeMap);
  await loadConditions(codeMap);

  console.log('\n완료. 검증 쿼리를 돌리세요:');
  console.log(`
select 'ingredients' t, count(*) from ingredients
union all select 'interactions', count(*) from dur_interactions
union all select 'conditions', count(*) from dur_conditions;

select condition_type, del_yn, count(*) from dur_conditions group by 1,2 order by 1,2;
select del_yn, count(*) from dur_interactions group by 1;
select distinct condition_value from dur_conditions where condition_type = 'age';
`);
}

main();

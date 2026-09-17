/**
 * #76 medication_ingredients 구축
 *
 * supabase/data/products-selected.csv (의약품 177건)
 *   + supabase/data/material-names.json (MATERIAL_NAME)
 *   → medication_ingredients
 *
 * 실행:
 *   dry-run:  npx tsx supabase/scripts/build-medication-ingredients.ts
 *   적재:     npx tsx supabase/scripts/build-medication-ingredients.ts --commit
 *
 * ────────────────────────────────────────────────
 * 이름으로 품목을 찾는 이유
 * ────────────────────────────────────────────────
 * products-selected.csv 의 식별자 칸은 health_foods 만 채워져 있다.
 * 의약품은 제품명으로 material-names.json 을 찾아야 한다.
 * 이름이 0건이거나 2건 이상이면 고르지 않고 멈춘다. 잘못 고르면
 * 엉뚱한 품목의 성분이 붙고 DUR 검사가 조용히 통과한다.
 *
 * ────────────────────────────────────────────────
 * 적재를 막는 조건
 * ────────────────────────────────────────────────
 * 에러가 1건이라도 있으면 --commit 이어도 적재하지 않는다.
 * 매칭 성분 0개인 품목도 같다. dur-items 에 있는 품목은 DUR 규칙이
 * 있다는 뜻이므로, 성분이 하나도 안 붙었다면 매칭 실패를 의심해야 한다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildNameIndex,
  dedupeIngredients,
  parseMaterialName,
  type IngredientRow,
} from './lib/parse-material-name';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCTS_CSV = join(process.cwd(), 'supabase/data/products-selected.csv');
const MATERIAL_NAMES = join(process.cwd(), 'supabase/data/material-names.json');
const REPORT_OUT = join(process.cwd(), 'supabase/data/reports/medication-ingredients.json');
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const COMMIT = process.argv.includes('--commit');

// 매칭 성분 0개인데 의약품안전나라에서 직접 확인하고 정상이라 판단한 item_seq.
// 넣을 때는 확인 근거를 주석으로 남길 것.
const REVIEWED_ZERO_MATCH = new Set<string>([]);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

// medication_ingredients 는 types 재생성 전이므로 타입 없이 쓴다.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type MaterialRow = {
  item_seq: string;
  name: string;
  etc_otc_code: string | null;
  cancel_name: string | null;
  material_name: string;
};

type Target = { itemSeq: string; name: string; materialName: string; cancelName: string | null };

/**
 * CSV 한 줄을 칸으로 자른다. "..." 로 묶인 칸 안의 쉼표는 구분자가 아니다.
 * 제품명 칸이 그런 경우가 있다:
 *   "스트렙실허니앤레몬트로키(플루르비프로펜), 스트렙실오렌지트로키(플루르비프로펜)"
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      // "" 는 따옴표 문자 자체
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (c === ',' && !inQuotes) {
      fields.push(field);
      field = '';
      continue;
    }
    field += c;
  }

  if (inQuotes) throw new Error(`CSV 따옴표가 닫히지 않음: ${line}`);
  fields.push(field);
  return fields;
}

/**
 * products-selected.csv 에서 출처가 medications 인 제품명 목록.
 *
 * 한 칸에 제품명이 여러 개 묶인 행이 있다(같은 진열 묶음의 맛 변형 등).
 * ", " 로 나눠서 각각을 독립 품목으로 다룬다. 나누기가 틀렸다면
 * 그 이름이 material-names.json 에서 안 잡히므로 뒤 단계에서 멈춘다.
 */
async function loadSelectedNames(): Promise<string[]> {
  const text = await readFile(PRODUCTS_CSV, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const [header, ...rows] = lines;

  const cols = splitCsvLine(header).map((c) => c.trim());
  const iSource = cols.indexOf('출처');
  const iName = cols.indexOf('제품명');
  if (iSource === -1 || iName === -1) {
    throw new Error(`CSV 헤더에 출처/제품명이 없습니다: ${header}`);
  }

  const names: string[] = [];
  const split: string[] = [];

  rows.forEach((line, idx) => {
    const fields = splitCsvLine(line);
    if (fields.length !== cols.length) {
      throw new Error(`CSV ${idx + 2}행 칸 수 이상 (${fields.length}/${cols.length}): ${line}`);
    }
    if (fields[iSource].trim() !== 'medications') return;

    const cell = fields[iName].trim();
    if (cell === '') throw new Error(`CSV ${idx + 2}행 제품명이 비어 있음`);

    const parts = cell
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '');
    if (parts.length > 1) split.push(`${idx + 2}행: ${parts.join(' | ')}`);
    names.push(...parts);
  });

  if (split.length > 0) {
    console.log(`\n한 칸에 제품명 여러 개 ${split.length}행 → 각각 분리`);
    split.forEach((s) => console.log(`  ${s}`));
    console.log('');
  }

  return [...new Set(names)];
}

/** 제품명 → material-names.json 의 품목. 0건·중복이면 멈춘다. */
async function resolveTargets(names: string[]): Promise<Target[]> {
  const materials: MaterialRow[] = JSON.parse(await readFile(MATERIAL_NAMES, 'utf-8'));

  const byName = new Map<string, MaterialRow[]>();
  for (const row of materials) {
    const key = row.name.trim();
    const list = byName.get(key);
    if (list === undefined) byName.set(key, [row]);
    else list.push(row);
  }

  const targets: Target[] = [];
  const notFound: string[] = [];
  const ambiguous: string[] = [];

  for (const name of names) {
    const hits = byName.get(name);
    if (hits === undefined) {
      notFound.push(name);
      continue;
    }
    if (hits.length > 1) {
      ambiguous.push(`${name} → ${hits.map((h) => h.item_seq).join(', ')}`);
      continue;
    }
    const hit = hits[0];
    targets.push({
      itemSeq: hit.item_seq,
      name: hit.name,
      materialName: hit.material_name,
      cancelName: hit.cancel_name,
    });
  }

  if (notFound.length > 0 || ambiguous.length > 0) {
    if (notFound.length > 0) {
      console.error(`\n❌ material-names.json 에 없는 제품명 ${notFound.length}건`);
      notFound.forEach((n) => console.error(`   ${n}`));
      console.error('   (이름 표기 차이이거나, MATERIAL_NAME 이 없는 품목)');
    }
    if (ambiguous.length > 0) {
      console.error(`\n❌ 같은 제품명이 여러 품목 ${ambiguous.length}건`);
      ambiguous.forEach((a) => console.error(`   ${a}`));
      console.error('   (CSV 식별자 칸에 item_seq 를 채워서 구분해야 한다)');
    }
    process.exit(1);
  }

  return targets;
}

/** item_seq → medications.id */
async function loadMedicationIds(itemSeqs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (let i = 0; i < itemSeqs.length; i += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('medications')
      .select('id, item_seq')
      .in('item_seq', itemSeqs.slice(i, i + BATCH_SIZE));
    if (error) throw new Error(`medications 조회 실패: ${error.message}`);

    for (const row of data) {
      if (map.has(row.item_seq)) {
        throw new Error(`medications 에 item_seq 중복: ${row.item_seq}`);
      }
      map.set(row.item_seq, row.id);
    }
  }

  const missing = itemSeqs.filter((s) => !map.has(s));
  if (missing.length > 0) {
    throw new Error(`medications 에 없는 item_seq ${missing.length}건: ${missing.join(', ')}`);
  }
  return map;
}

async function loadIngredients(): Promise<IngredientRow[]> {
  const all: IngredientRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, code, name_ko, ori_names')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`ingredients 조회 실패: ${error.message}`);

    all.push(...(data as IngredientRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  const names = await loadSelectedNames();
  console.log(`CSV 의약품 ${names.length}건`);

  const targets = await resolveTargets(names);
  const medIds = await loadMedicationIds(targets.map((t) => t.itemSeq));
  const nameIndex = buildNameIndex(await loadIngredients());
  console.log(`성분 이름 인덱스 ${nameIndex.size}개`);

  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const zeroMatch: string[] = [];
  const unmatched: { item_seq: string; name: string; raw_name: string }[] = [];
  const cancelled: string[] = [];

  for (const target of targets) {
    const label = `${target.itemSeq} ${target.name}`;

    // 취하·취소 품목은 판매 후보로 부적절하다. 멈추지는 않고 목록만 남긴다.
    if (target.cancelName !== null && target.cancelName !== '정상') {
      cancelled.push(`${label} (${target.cancelName})`);
    }

    let parsed;
    try {
      parsed = dedupeIngredients(parseMaterialName(target.materialName), target.materialName);
    } catch (e) {
      errors.push(`파싱 실패: ${label}\n  ${(e as Error).message}`);
      continue;
    }

    let matched = 0;
    for (const ing of parsed) {
      const ids = nameIndex.get(ing.rawName);

      if (ids !== undefined && ids.size > 1) {
        errors.push(`매칭 모호 (성분 ${ids.size}개): ${label} / ${ing.rawName}`);
        continue;
      }

      let ingredientId: string | null = null;
      if (ids === undefined) {
        unmatched.push({ item_seq: target.itemSeq, name: target.name, raw_name: ing.rawName });
      } else {
        ingredientId = [...ids][0];
        matched++;
      }

      rows.push({
        medication_id: medIds.get(target.itemSeq),
        ingredient_id: ingredientId,
        raw_name: ing.rawName,
        amount: ing.amount,
        unit: ing.unit,
      });
    }

    if (matched === 0 && !REVIEWED_ZERO_MATCH.has(target.itemSeq)) {
      zeroMatch.push(label);
    }
  }

  const matchedRows = rows.filter((r) => r.ingredient_id !== null).length;

  await mkdir(dirname(REPORT_OUT), { recursive: true });
  await writeFile(
    REPORT_OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targets: targets.length,
        rows: rows.length,
        matchedRows,
        errors,
        zeroMatch,
        cancelled,
        unmatched,
      },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`\n품목 ${targets.length} / 성분 행 ${rows.length}`);
  console.log(`  매칭 ${matchedRows} / 미매칭 ${unmatched.length}`);
  console.log(
    `  에러 ${errors.length} / 매칭0 품목 ${zeroMatch.length} / 취하·취소 ${cancelled.length}`
  );
  console.log(`리포트: ${REPORT_OUT}`);

  if (errors.length > 0 || zeroMatch.length > 0) {
    console.error('\n❌ 에러 또는 매칭0 품목이 있어 적재하지 않습니다. 리포트를 확인하세요.');
    errors.slice(0, 5).forEach((e) => console.error(`   ${e}`));
    zeroMatch.slice(0, 5).forEach((z) => console.error(`   매칭0: ${z}`));
    process.exit(1);
  }

  if (!COMMIT) {
    console.log('\n(dry-run) 적재하려면 --commit');
    return;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('medication_ingredients')
      .upsert(batch, { onConflict: 'medication_id,raw_name' });

    if (error) {
      console.error(`  ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log(`\n✅ ${rows.length}행 적재 완료`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * #15 products 적재
 *
 * 입력
 *   supabase/data/products-selected.csv        선정 199개 (식별자 채워진 상태)
 *   supabase/data/product-display-names.json   표시명 수동 지정 (없으면 자동 생성)
 *
 * 실행:
 *   dry-run:  npm run seed:products
 *   적재:     npm run seed:products -- --commit
 *
 * ────────────────────────────────────────────────
 * CSV 에 없는 값은 어떻게 채우나
 * ────────────────────────────────────────────────
 * price          중분류 기준가 ±20%, 100원 단위. 상품명 해시라 다시 돌려도 같은 값
 * dosage_form    제품명에서 추정. 안 되면 건기식은 성상(appearance)으로 재시도
 * child_allowed  연령금기(소아 기준)에 걸리는 성분이 있으면 false
 * image_key      제형·중분류에서 목업 용기 선택
 * label_color    대분류별 색상 토큰
 * stock / sales  상품명 해시로 고정값
 *
 * 추정이 안 되는 건 채우지 않고 목록으로 뽑아 멈춘다.
 *
 * ────────────────────────────────────────────────
 * child_allowed 의 의미 (중요)
 * ────────────────────────────────────────────────
 * 목록 필터·배지용 값이다. 연령금기에 "○세 미만/이하" 규칙이 등재된 성분이 있으면 false.
 * "65세 초과"는 노인주의라 소아 판정에서 제외한다.
 *
 * 규칙이 없다고 어린이가 먹어도 된다는 뜻은 아니다. 식약처 DUR 은 금지만 등재한다.
 * 실제 복용 가능 판정은 복약정보(나이)를 받아 장바구니·주문 시점 DUR 검사가 담당한다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA = join(process.cwd(), 'supabase/data');
const PRODUCTS_CSV = join(DATA, 'products-selected.csv');
const DISPLAY_NAMES = join(DATA, 'product-display-names.json');
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const COMMIT = process.argv.includes('--commit');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── 기준값 ────────────────────────────────────────────

/** 중분류 기준가 */
const PRICE: Record<string, number> = {
  종합감기: 3000,
  '목·인후': 3000,
  '코·비염': 3000,
  알레르기: 3000,
  해열진통: 3500,
  소염진통: 3500,
  '파스·진통패치': 5000,
  '소화·속쓰림': 3000,
  '변비·설사': 2000,
  '연고·외용제': 5000,
  소독약: 3000,
  피부미용: 12000,
  인공눈물: 5000,
  잇몸: 15000,
  '엽산·임산부': 20000,
  철분: 18000,
  어린이감기: 4500,
  어린이영양제: 15000,
  종합비타민: 30000,
  비타민: 15000,
  오메가3: 30000,
  마그네슘: 20000,
  루테인: 25000,
  유산균: 35000,
  간건강: 25000,
  '뼈·관절': 28000,
  수면: 5000,
  피로회복: 8000,
  숙취: 5000,
  구충: 2000,
  멀미: 3000,
};

/** 대분류별 색상 토큰. 디자인 토큰이 정해지면 여기만 바꾸면 된다 */
const LABEL_COLOR: Record<string, string> = {
  '감기·호흡기': 'sky',
  '진통·해열': 'red',
  '소화·위장': 'amber',
  '피부·상처': 'mint',
  '눈·구강': 'indigo',
  '여성·임신': 'pink',
  어린이: 'orange',
  '영양·컨디션': 'green',
  '기타 상비': 'slate',
};

/** 제형 추정 규칙. 먼저 맞는 것이 이긴다 */
const FORM_RULES: { form: string; test: RegExp }[] = [
  {
    form: '외용',
    test: /(연고|크림|겔|로션|패취|패치|플라스타|카타플라스마|파스|스프레이|분무|외용액|도포)/,
  },
  {
    form: '시럽·액상',
    test: /(시럽|내복액|드링크|현탁액|점안액|점안겔|안연고|액상|에멀젼|액$|액\(|액\)|액\s)/,
  },
  { form: '산제·과립', test: /(과립|산제|가루|분말|건조시럽|포\b)/ },
  { form: '캡슐', test: /(캡슐)/ },
  { form: '정제', test: /(정$|정\(|정\)|정\s|정\d|정제|서방정|츄어블|트로키|장용정)/ },
];

/** 중분류가 제형을 결정하는 경우. 이름 추정보다 우선한다 */
const FORM_BY_SUB: Record<string, string> = {
  '연고·외용제': '외용',
  소독약: '외용',
  '파스·진통패치': '외용',
  인공눈물: '시럽·액상',
};

/** 제형·중분류 → 목업 용기 */
function imageKey(form: string, sub: string): string {
  if (sub === '인공눈물') return 'dropper-bottle';
  if (sub === '파스·진통패치') return 'pouch-zip';
  switch (form) {
    case '정제':
      return 'bottle';
    case '캡슐':
      return 'cylinder';
    case '시럽·액상':
      return 'bottle-02';
    case '산제·과립':
      return 'pouch';
    case '외용':
      return 'tube';
    default:
      return 'box-wide';
  }
}

// ─── 유틸 ──────────────────────────────────────────────

const norm = (s: string) => s.replace(/\s+/g, '');
const clean = (v: string | null | undefined) => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/** 상품명 기준 고정 난수(0~1). 다시 실행해도 같은 값이 나온다 */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
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
  if (inQuotes) throw new Error(`CSV 따옴표가 닫히지 않음: ${line}`);
  fields.push(field);
  return fields;
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * 표시명 다듬기.
 * - "※..." 이후 메모 제거
 * - 맨 뒤 괄호 묶음 제거: 성분명·수출명 (타이레놀정500밀리그람(아세트아미노펜) → 타이레놀정500밀리그람)
 *   중간 괄호는 건드리지 않는다 (미보(MEBO)연고)
 * - 쉼표로 여러 제품이 묶인 레코드는 자동으로 정하지 않고 멈춘다 → 수동 파일에 지정
 */
function deriveDisplayName(raw: string): string {
  let s = raw.split('※')[0].trim();
  while (true) {
    const m = s.match(/^(.*?)\s*\([^()]*\)$/);
    if (m === null || m[1].trim() === '') break;
    s = m[1].trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** 연령금기 AGE_BASE 가 소아 기준인지. "65세 초과" 같은 노인 기준은 제외 */
function isChildLimit(ageBase: string | null): boolean {
  if (ageBase === null) return false;
  return /(미만|이하)/.test(ageBase) && !/초과|이상/.test(ageBase);
}

// ─── main ──────────────────────────────────────────────

type Category = { id: string; name: string; parent_id: string | null };
type Medication = { id: string; item_seq: string; name: string };
type HealthFood = { id: string; sttemnt_no: string; name: string; appearance: string | null };

async function main() {
  // 1. CSV
  const text = await readFile(PRODUCTS_CSV, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((c) => c.trim());
  const [iTop, iSub, iSource, iName, iId] = ['대분류', '중분류', '출처', '제품명', '식별자'].map(
    (c) => {
      const i = header.indexOf(c);
      if (i === -1) throw new Error(`CSV 헤더에 ${c} 없음`);
      return i;
    }
  );

  const csv = lines.slice(1).map((line, idx) => {
    const f = splitCsvLine(line);
    if (f.length !== header.length) throw new Error(`CSV ${idx + 2}행 칸 수 이상: ${line}`);
    return {
      line: idx + 2,
      top: f[iTop].trim(),
      sub: f[iSub].trim(),
      source: f[iSource].trim(),
      rawName: f[iName].trim(),
      id: f[iId].trim(),
    };
  });
  console.log(
    `CSV ${csv.length}행 (의약품 ${csv.filter((r) => r.source === 'medications').length})`
  );

  // 2. 참조 테이블
  const cats = await selectAll<Category>('categories', 'id, name, parent_id');
  const meds = await selectAll<Medication>('medications', 'id, item_seq, name');
  const foods = await selectAll<HealthFood>('health_foods', 'id, sttemnt_no, name, appearance');

  const topCat = new Map(cats.filter((c) => c.parent_id === null).map((c) => [norm(c.name), c]));
  const subCat = new Map(
    cats.filter((c) => c.parent_id !== null).map((c) => [`${c.parent_id}|${norm(c.name)}`, c])
  );
  const medBySeq = new Map(meds.map((m) => [m.item_seq, m]));
  const foodByNo = new Map(foods.map((f) => [f.sttemnt_no, f]));
  console.log(
    `categories ${cats.length} / medications ${meds.length} / health_foods ${foods.length}`
  );

  // 3. 연령금기(소아) 성분
  const conds = await selectAll<{ ingredient_id: string; condition_value: string | null }>(
    'dur_conditions',
    'ingredient_id, condition_value, condition_type, del_yn'
  ).then((rows) =>
    rows.filter(
      (r) =>
        (r as unknown as { condition_type: string }).condition_type === 'age' &&
        (r as unknown as { del_yn: string }).del_yn === '정상' &&
        isChildLimit(r.condition_value)
    )
  );
  const childBanned = new Set(conds.map((c) => c.ingredient_id));

  const links = await selectAll<{ medication_id: string; ingredient_id: string | null }>(
    'medication_ingredients',
    'medication_id, ingredient_id'
  );
  const medChildBanned = new Set(
    links
      .filter((l) => l.ingredient_id !== null && childBanned.has(l.ingredient_id))
      .map((l) => l.medication_id)
  );
  console.log(`소아 연령금기 성분 ${childBanned.size}개 → 해당 품목 ${medChildBanned.size}건`);

  // 4. 표시명 파일
  let display: Record<string, string> = {};
  if (await exists(DISPLAY_NAMES)) {
    display = JSON.parse(await readFile(DISPLAY_NAMES, 'utf-8'));
  }

  // 5. 행 만들기
  const rows: Record<string, unknown>[] = [];
  const problems: string[] = [];
  const needDisplayName: Record<string, string> = {};
  const renamed: string[] = [];

  for (const r of csv) {
    const where = `${r.line}행 ${r.rawName}`;

    // 카테고리
    const top = topCat.get(norm(r.top));
    if (top === undefined) {
      problems.push(`${where}: 대분류 '${r.top}' 없음`);
      continue;
    }
    const sub = subCat.get(`${top.id}|${norm(r.sub)}`);
    if (sub === undefined) {
      problems.push(`${where}: 중분류 '${r.top} > ${r.sub}' 없음`);
      continue;
    }

    // 출처
    if (r.id === '') {
      problems.push(`${where}: 식별자 비어 있음`);
      continue;
    }
    const isMed = r.source === 'medications';
    const med = isMed ? medBySeq.get(r.id) : undefined;
    const food = isMed ? undefined : foodByNo.get(r.id);
    if (isMed && med === undefined) {
      problems.push(`${where}: medications 에 item_seq ${r.id} 없음`);
      continue;
    }
    if (!isMed && food === undefined) {
      problems.push(`${where}: health_foods 에 신고번호 ${r.id} 없음`);
      continue;
    }

    // 표시명
    let name = display[r.id];
    if (name === undefined) {
      name = deriveDisplayName(r.rawName);
      if (name.includes(',')) {
        // 한 레코드에 여러 제품이 묶인 경우. 자동으로 고르지 않는다
        needDisplayName[r.id] = name;
        continue;
      }
    }
    const origin = (med?.name ?? food?.name ?? '').replace(/\s+/g, ' ');
    if (norm(name) !== norm(origin)) renamed.push(`${name}   ← ${origin}`);

    // 제형
    const formSource = `${r.rawName} ${food?.appearance ?? ''}`;
    const form = FORM_BY_SUB[r.sub] ?? FORM_RULES.find((rule) => rule.test.test(formSource))?.form;
    if (form === undefined) {
      problems.push(
        `${where}: 제형 추정 실패${food ? ` (성상: ${food.appearance ?? '없음'})` : ''}`
      );
      continue;
    }

    // 가격: 중분류 기준가 ±20%, 100원 단위
    const base = PRICE[r.sub];
    if (base === undefined) {
      problems.push(`${where}: 중분류 '${r.sub}' 기준가 없음`);
      continue;
    }
    const price = Math.round((base * (0.8 + hash01(name) * 0.4)) / 100) * 100;

    const color = LABEL_COLOR[r.top];
    if (color === undefined) {
      problems.push(`${where}: 대분류 '${r.top}' 색상 없음`);
      continue;
    }

    rows.push({
      name,
      price,
      image_key: imageKey(form, r.sub),
      label_color: color,
      category_id: sub.id,
      medication_id: med?.id ?? null,
      health_food_id: food?.id ?? null,
      dosage_form: form,
      // 건기식은 DUR 대상이 아니라 연령금기 판정 근거가 없다. 어린이 카테고리만 true
      child_allowed: med !== undefined ? !medChildBanned.has(med.id) : r.top === '어린이',
      stock: 30 + Math.floor(hash01(`stock:${name}`) * 170),
      sales_count: Math.floor(hash01(`sales:${name}`) * 500),
      is_active: true,
    });
  }

  // 6. 표시명 수동 지정이 필요하면 파일로 뽑고 멈춘다
  if (Object.keys(needDisplayName).length > 0) {
    const merged = { ...display, ...needDisplayName };
    await writeFile(DISPLAY_NAMES, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    console.error(`\n❌ 표시명을 직접 정해야 하는 품목 ${Object.keys(needDisplayName).length}건`);
    for (const [id, v] of Object.entries(needDisplayName)) console.error(`   ${id}  ${v}`);
    console.error(`\n   ${DISPLAY_NAMES} 에서 값을 고친 뒤 다시 실행하세요.`);
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error(`\n❌ 적재하지 않습니다 (${problems.length}건)`);
    problems.forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }

  // 7. 요약
  const byForm = new Map<string, number>();
  for (const r of rows)
    byForm.set(r.dosage_form as string, (byForm.get(r.dosage_form as string) ?? 0) + 1);

  console.log(`\n적재 대상 ${rows.length}건`);
  console.log(`  제형: ${[...byForm].map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  console.log(
    `  어린이 복용 가능 ${rows.filter((r) => r.child_allowed).length} / 성인용 ${rows.filter((r) => !r.child_allowed).length}`
  );
  console.log(
    `  가격 ${Math.min(...rows.map((r) => r.price as number))} ~ ${Math.max(...rows.map((r) => r.price as number))}원`
  );
  console.log(`\n표시명이 원본과 다른 품목 ${renamed.length}건 (앞 10건)`);
  renamed.slice(0, 10).forEach((r) => console.log(`   ${r}`));

  if (!COMMIT) {
    console.log('\n(dry-run) 적재하려면 -- --commit');
    return;
  }

  // 8. 적재. 재실행 시 중복되지 않도록 전체 교체
  const { error: delError } = await supabase
    .from('products')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delError) {
    console.error('기존 행 삭제 실패:', delError.message);
    process.exit(1);
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('products').insert(batch);
    if (error) {
      console.error(`  ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  console.log(`\n✅ ${rows.length}건 적재 완료`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

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
 * child_allowed  연령금기(소아 기준)에 걸리는 성분이 있으면 false, 제형 조건(form_name)이 있으면 의약품 원본 이름이 그 제형일 때만
 * image_key      상품 이미지 파일명 (= 식별자, public/images/products/{식별자}.png)
 * label_color    중분류별 색상 토큰 (실제 포장 대체용, 같은 대분류 안에서 겹치지 않게)
 * sales_count  sales-tiers.json 등급(top/mid), 나머지는 식별자 해시 0~100
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
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CHILD_AGE_LIMIT_MONTHS, formatChildAge } from '../../src/lib/products/child-age';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA = join(process.cwd(), 'supabase/data');
const PRODUCTS_CSV = join(DATA, 'products-selected.csv');
const DISPLAY_NAMES = join(DATA, 'product-display-names.json');
const CHILD_AGES = join(DATA, 'child-ages.json');
const SALES_TIERS = join(DATA, 'sales-tiers.json');

/** 판매량 초기값. 이후 결제 승인 시 서버에서 누적된다 */
const TOP_SALES = [2000, 1800, 1600]; // 랜딩 베스트셀러 1~3등
const MID_SALES_START = 560; // 중 등급 첫 번째, 이후 20씩 감소
const MID_SALES_STEP = 20;
const LOW_SALES_MAX = 100; // 나머지: 0 ~ 100

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

/** 중분류별 라벨 색. 실제 포장 대신 쓰는 색이라 카테고리 의미는 없고,
 *  같은 대분류 안에서만 겹치지 않게 배정했다 */
const LABEL_COLOR: Record<string, string> = {
  // 감기·호흡기
  종합감기: 'sky',
  '목·인후': 'mint',
  '코·비염': 'indigo',
  알레르기: 'lime',
  // 진통·해열
  해열진통: 'red',
  소염진통: 'coral',
  '파스·진통패치': 'orange',
  // 소화·위장
  '소화·속쓰림': 'amber',
  '변비·설사': 'green',
  // 피부·상처
  '연고·외용제': 'sky',
  피부미용: 'pink',
  소독약: 'slate',
  // 눈·구강
  인공눈물: 'indigo',
  잇몸: 'coral',
  // 여성·임신
  '엽산·임산부': 'pink',
  철분: 'red',
  // 어린이
  어린이감기: 'orange',
  어린이영양제: 'lime',
  // 영양·컨디션
  비타민: 'amber', // orange → amber (버터 옐로)
  종합비타민: 'orange', // amber → orange (살구)
  마그네슘: 'indigo',
  오메가3: 'sky',
  유산균: 'pink',
  피로회복: 'red',
  루테인: 'lime',
  간건강: 'red', // green → red (로즈)
  '뼈·관절': 'slate',
  수면: 'mint',
  숙취: 'coral',
  // 기타 상비
  구충: 'slate',
  멀미: 'sky',
};

/** 영양 계열은 성분별로 포장 색을 다르게. 여기 없으면 대분류 색 */
const LABEL_COLOR_BY_SUB: Record<string, string> = {
  비타민: 'amber', // orange → amber (버터 옐로)
  종합비타민: 'orange', // amber → orange (살구)
  마그네슘: 'indigo',
  오메가3: 'sky',
  유산균: 'pink',
  피로회복: 'red',
  루테인: 'lime',
  간건강: 'red', // green → red (로즈)
  '뼈·관절': 'slate',
  수면: 'mint',
  숙취: 'coral',
};

/** 제형 추정 규칙. 먼저 맞는 것이 이긴다 → 좁은 규칙을 위에 */
const FORM_RULES: { form: string; test: RegExp }[] = [
  // 이름에 '겔'·'시럽'이 들어가 넓은 규칙에 잘못 걸리는 것들
  { form: '산제·과립', test: /건조시럽/ },
  { form: '시럽·액상', test: /현탁액/ },
  { form: '캡슐', test: /캡슐/ },
  // 넓은 규칙
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
/**
 * DUR form_name 토큰을 계열로 분류하고, 계열마다 의약품 원본 이름에서 찾을 패턴을 둔다.
 * 위에서부터 먼저 맞는 계열이 이긴다 → 좁은 계열을 위에
 *   예) 서방성경피흡수제: '패치'가 '서방'보다 위라 패치로 분류
 *       피부액제: '피부'가 '먹는 액상'보다 위라 피부로 분류
 * 어느 계열에도 안 맞는 토큰은 규칙을 적용(보수적)하고 적재를 멈춘다
 */
type FormFamily = { family: string; token: RegExp; name: RegExp };

const DUR_FORM_FAMILIES: FormFamily[] = [
  // 판매하지 않는 경로. 상품 이름에 안 나오는 말이라 사실상 해당 없음
  { family: '주사', token: /주사/, name: /주사/ },
  {
    family: '체내·특수',
    token: /질세정|질정|질용|직장|방광|관류|이식|혈액|장기보존|밀폐제|단자시험/,
    name: /질정|질세정|좌제|좌약|관장/,
  },

  // 눈·귀·코·입
  { family: '눈', token: /점안|안연고|안겔/, name: /점안|안연고|안겔/ },
  { family: '귀', token: /점이/, name: /점이/ },
  { family: '분무', token: /분무/, name: /분무|스프레이/ },
  { family: '가글', token: /가글/, name: /가글|양치/ },

  // 붙이는 것
  {
    family: '패치',
    token: /경피|첩부|카타플라스마|플라스타/,
    name: /패취|패치|플라스타|카타플라스마|파스/,
  },

  // 바르는 것 (먹는 겔은 위에서 먼저 뺀다)
  { family: '먹는 겔', token: /경구용겔/, name: /겔/ },
  {
    family: '피부',
    token: /피부|연고|크림|^겔$|겔제|로션|리니멘트|샴푸|틴크|도료/,
    name: /연고|크림|겔|로션|리니멘트|샴푸|틴크|외용|도포|도료/,
  },

  // 먹는 것
  { family: '서방', token: /서방/, name: /서방|이알/ },
  { family: '캡슐', token: /캡슐/, name: /캡슐/ },
  {
    family: '먹는 액상',
    token: /시럽|현탁|액제|유제|레모네이드|방향수|주정|침제|전제/,
    name: /시럽|현탁|내복액|드링크|유제|에멀젼|액($|\(|\s)/,
  },
  { family: '필름', token: /구강붕해필름/, name: /필름|붕해/ },
  {
    family: '가루',
    token: /산제|과립|세립|분말/,
    name: /산제|산($|\(|\s)|가루|분말|과립|세립|건조시럽/,
  },
  { family: '정제', token: /정$|정제$|츄어블/, name: /정($|\d|\(|\s|제)/ },
];

const familyOf = (token: string) => DUR_FORM_FAMILIES.find((f) => f.token.test(token));

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

/** 연령금기 나이 → 복용 가능 시작(개월). "12세 미만"→144, "15세 이하"→192, "4주 미만"→1 */
function ruleMinMonths(value: string | null): number | null {
  if (value === null) return null;
  const m = value.match(/(\d+)\s*(세|개월|주)\s*(미만|이하)/);
  if (m === null) return null;
  const n = Number(m[1]) + (m[3] === '이하' ? 1 : 0);
  if (m[2] === '세') return n * 12;
  if (m[2] === '개월') return n;
  return Math.ceil(n / 4); // 주 → 개월, 넉넉하게 올림
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

  // 3. 연령금기(소아) 규칙. 제형 조건(form_name)까지 함께 가져온다
  type AgeRule = {
    ingredient_id: string;
    condition_value: string | null;
    form_name: string | null;
    condition_type: string;
    del_yn: string;
  };
  const ageRules = (
    await selectAll<AgeRule>(
      'dur_conditions',
      'ingredient_id, condition_value, form_name, condition_type, del_yn'
    )
  ).filter(
    (r) => r.condition_type === 'age' && r.del_yn === '정상' && isChildLimit(r.condition_value)
  );

  const rulesByIngredient = new Map<string, AgeRule[]>();
  for (const r of ageRules) {
    const list = rulesByIngredient.get(r.ingredient_id) ?? [];
    list.push(r);
    rulesByIngredient.set(r.ingredient_id, list);
  }

  const links = await selectAll<{ medication_id: string; ingredient_id: string | null }>(
    'medication_ingredients',
    'medication_id, ingredient_id'
  );
  const ingredientsByMed = new Map<string, string[]>();
  for (const l of links) {
    if (l.ingredient_id === null) continue;
    const list = ingredientsByMed.get(l.medication_id) ?? [];
    list.push(l.ingredient_id);
    ingredientsByMed.set(l.medication_id, list);
  }

  const unknownForms = new Map<string, Set<string>>(); // 토큰 → 걸린 상품
  const classified = new Map<string, string>(); // 토큰 → 계열 (검수용)

  function ruleApplies(rule: AgeRule, medName: string): boolean {
    if (rule.form_name === null || rule.form_name.trim() === '') return true;
    const tokens = rule.form_name
      .split(/[\/,]/)
      .map((t) => t.trim())
      .filter(Boolean);

    // some 은 중간에 멈춰 뒤쪽 토큰을 놓친다 → 전부 검사한 뒤 판단
    const results = tokens.map((token) => {
      const family = familyOf(token);
      if (family === undefined) {
        const products = unknownForms.get(token) ?? new Set<string>();
        products.add(medName);
        unknownForms.set(token, products);
        return true; // 모르면 적용한다 (누락보다 과잉이 낫다)
      }
      classified.set(token, family.family);
      return family.name.test(medName);
    });
    return results.some(Boolean);
  }

  /** 소아 금기에 걸리는 규칙 목록. 비어 있으면 어린이 복용 가능 */
  function childBlockingRules(med: Medication): AgeRule[] {
    const ingredientIds = ingredientsByMed.get(med.id) ?? [];
    return ingredientIds
      .flatMap((id) => rulesByIngredient.get(id) ?? [])
      .filter((rule) => ruleApplies(rule, med.name));
  }

  const childBlocked: string[] = []; // 검수용 출력
  console.log(`소아 연령금기 규칙 ${ageRules.length}건`);

  // 4. 표시명 파일
  let display: Record<string, string> = {};
  if (await exists(DISPLAY_NAMES)) {
    display = JSON.parse(await readFile(DISPLAY_NAMES, 'utf-8'));
  }

  // 4-1. 판매량 등급 파일
  type TierItem = { code: string; name: string };
  const tiers: { top: TierItem[]; mid: TierItem[] } = JSON.parse(
    await readFile(SALES_TIERS, 'utf-8')
  );
  if (tiers.top.length !== TOP_SALES.length) {
    throw new Error(
      `sales-tiers.json top 은 ${TOP_SALES.length}개여야 함 (현재 ${tiers.top.length})`
    );
  }
  const fixedSales = new Map<string, number>();
  tiers.top.forEach((t, i) => fixedSales.set(t.code, TOP_SALES[i]));
  tiers.mid.forEach((t, i) => fixedSales.set(t.code, MID_SALES_START - i * MID_SALES_STEP));
  if (fixedSales.size !== tiers.top.length + tiers.mid.length) {
    throw new Error('sales-tiers.json 에 중복 code 가 있음');
  }

  // 4-2. 어린이 복용 가능 나이. 허가 용법을 보고 사람이 확정한 값 (실무의 상품 등록 입력에 해당)
  type ChildAge = { name: string; months: number | null; source: string };
  const childAges: Record<string, ChildAge> = JSON.parse(await readFile(CHILD_AGES, 'utf-8'));

  // 5. 행 만들기
  const rows: Record<string, unknown>[] = [];
  const problems: string[] = [];
  const needDisplayName: Record<string, string> = {};
  const renamed: string[] = [];
  const preview: string[] = ['중분류,상품명,제형,image_key,label_color'];

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

    const color = LABEL_COLOR[r.sub];
    if (color === undefined) {
      problems.push(`${where}: 중분류 '${r.sub}' 색상 없음`);
      continue;
    }

    const img = r.id;
    preview.push([r.sub, name, form, img, color].map((v) => `"${v}"`).join(','));

    // ── 어린이 ──────────────────────────────
    // child_allowed: 소아 연령금기(제형 반영)에 안 걸림. 화면엔 안 쓰고 교차 검사용
    // child_min_age_months: 허가 용법상 최소 나이. 배지·필터용 (child-ages.json)
    const blocking = med !== undefined ? childBlockingRules(med) : [];
    const childAllowed = med !== undefined ? blocking.length === 0 : r.top === '어린이';
    if (blocking.length > 0) {
      childBlocked.push(
        `${name}: ${blocking.map((b) => `${b.condition_value} (${b.form_name ?? '제형무관'})`).join(', ')}`
      );
    }

    // 파일에 없음 = 어린이 용량 없음
    const childMinAge = childAges[r.id]?.months ?? null;

    // 용법은 2세부터인데 DUR 은 12세 미만 금기 → 둘 중 하나가 이상하다
    if (childMinAge !== null) {
      for (const rule of blocking) {
        const ruleMin = ruleMinMonths(rule.condition_value);
        if (ruleMin === null) {
          problems.push(`${where}: 연령금기 나이 해석 실패 '${rule.condition_value}'`);
        } else if (childMinAge < ruleMin) {
          problems.push(
            `${where}: 용법 ${formatChildAge(childMinAge)} 인데 DUR '${rule.condition_value}' 금기 → 확인 필요`
          );
        }
      }
    }

    // 어린이 카테고리 의약품인데 어린이 나이가 없으면 뭔가 빠진 것 (건기식은 연령 표기가 없어 제외)
    if (
      med !== undefined &&
      r.top === '어린이' &&
      (childMinAge === null || childMinAge >= CHILD_AGE_LIMIT_MONTHS)
    ) {
      problems.push(`${where}: 어린이 카테고리인데 어린이 나이 없음 → child-ages.json 에 지정`);
    }

    rows.push({
      code: r.id, // ← 추가
      name,
      price,
      image_key: img,
      label_color: color,
      category_id: sub.id,
      medication_id: med?.id ?? null,
      health_food_id: food?.id ?? null,
      dosage_form: form,
      // 건기식은 DUR 대상이 아니라 연령금기 판정 근거가 없다. 어린이 카테고리만 true
      child_allowed: childAllowed,
      child_min_age_months: childMinAge,
      stock: 30 + Math.floor(hash01(`stock:${name}`) * 170),
      // ← 교체
      sales_count:
        fixedSales.get(r.id) ?? Math.floor(hash01(`sales:${r.id}`) * (LOW_SALES_MAX + 1)),
      is_active: true,
    });
  }

  // 등급 파일의 code 가 실제 상품에 다 있는지. 오타면 조용히 하 등급으로 떨어지므로 막는다
  const rowCodes = new Set(rows.map((r) => r.code));
  for (const t of [...tiers.top, ...tiers.mid]) {
    if (!rowCodes.has(t.code))
      problems.push(`sales-tiers.json: 상품에 없는 code ${t.code} (${t.name})`);
  }

  for (const code of Object.keys(childAges)) {
    if (!rowCodes.has(code)) problems.push(`child-ages.json: 상품에 없는 code ${code}`);
  }

  if (unknownForms.size > 0) {
    for (const [token, products] of unknownForms) {
      problems.push(`분류 안 되는 제형 조건 '${token}' ← ${[...products].join(', ')}`);
    }
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
  const childBadge = rows.filter((r) => {
    const m = r.child_min_age_months as number | null;
    return m !== null && m < CHILD_AGE_LIMIT_MONTHS;
  }).length;
  console.log(
    `  어린이 나이 배지 ${childBadge}개 / 연령금기 없음(child_allowed) ${rows.filter((r) => r.child_allowed).length}개`
  );

  console.log(`\n어린이 불가 ${childBlocked.length}건`);
  childBlocked.forEach((c) => console.log(`   ${c}`));

  console.log(`\n제형 토큰 분류 ${classified.size}개`);
  const byFamily = new Map<string, string[]>();
  for (const [token, family] of classified) {
    byFamily.set(family, [...(byFamily.get(family) ?? []), token]);
  }
  for (const [family, tokens] of byFamily) console.log(`   ${family}: ${tokens.join(', ')}`);

  console.log(
    `  가격 ${Math.min(...rows.map((r) => r.price as number))} ~ ${Math.max(...rows.map((r) => r.price as number))}원`
  );
  console.log(`\n표시명이 원본과 다른 품목 ${renamed.length}건 (앞 10건)`);
  renamed.slice(0, 10).forEach((r) => console.log(`   ${r}`));

  const reportDir = join(DATA, 'reports');
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, 'products-preview.csv'), '\uFEFF' + preview.join('\n'), 'utf-8');
  console.log(`\n검수용: supabase/data/reports/products-preview.csv`);

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

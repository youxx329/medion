/**
 * #76 medication_ingredients 적재
 *
 * 입력
 *   supabase/data/products-selected.csv         선정 의약품
 *   supabase/data/drug-ingredients/*.json        주성분 상세 (원료·함량)
 *   supabase/data/dur/**                         금기 원본 (M코드 → D코드 매핑)
 *   supabase/data/mcode-overrides.json           사람이 확정한 매핑 / 기각한 후보
 *
 * 출력
 *   medication_ingredients
 *   supabase/data/reports/medication-ingredients.json   전체 결과
 *   supabase/data/reports/mcode-candidates.json         검수 대기 후보
 *
 * 실행:
 *   dry-run:  npm run build:medication-ingredients
 *   적재:     npm run build:medication-ingredients -- --commit
 *
 * ────────────────────────────────────────────────
 * 계층: 약품 > 원료(M코드) > 성분(D코드)
 * ────────────────────────────────────────────────
 * 약은 원료를 담고, DUR 규칙은 성분에 걸린다. 같은 성분이라도 제형·염·표기에 따라
 * 원료 코드가 여러 개다 (아세트아미노펜 / 아세트아미노펜제피세립 / 미분화 ...).
 *
 * ────────────────────────────────────────────────
 * 매칭 순서
 * ────────────────────────────────────────────────
 * 1. 코드: 금기 원본 중 MIX_TYPE='단일' 행의 ORI 로 M→D 매핑을 만든다.
 *    '복합' 행의 ORI 에는 복합제에 함께 든 다른 성분의 M코드까지 섞여 있어 쓰지 않는다.
 *
 * 2. 수동 매핑: mcode-overrides.json 의 mappings.
 *    금기 원본의 ORI 가 모든 원료 표기를 담지 않는다. 표기법이 바뀌며 새로 생긴
 *    원료 코드가 옛 규칙에 추가되지 않은 경우가 있다.
 *      예) 오트리빈 원료 M257887 자일로메타졸린염산염
 *          키실로메타졸린 D000564 규칙엔 M051554 염산키실로메타졸린만 있음
 *    한글 음역도 달라(자일로/키실로) 이름으로도 못 잇는다.
 *
 * 3. 후보 추출: 1·2 로 못 이은 품목에서, 영문 성분명(MAIN_INGR_ENG)에
 *    ingredients.name_en 이 단어로 포함되면 후보로 올린다. 자동 확정하지 않는다.
 *    사람이 의약품안전나라에서 확인한 뒤 mappings 에 옮기거나 dismissed 에 기록한다.
 *
 * ────────────────────────────────────────────────
 * 원료 하나 → D코드 여러 개
 * ────────────────────────────────────────────────
 * 같은 물질에 D코드가 여러 개인 경우가 있고 양쪽 다 규칙이 걸려 있기도 하다.
 *   피록시캄 D000309 (조건 3 / 병용 2)   D000983 (조건 1)
 * 원료 행을 D코드마다 하나씩 만든다. 하나만 고르면 다른 쪽 규칙을 놓친다.
 * unique (medication_id, raw_name, tamt_seq, ingredient_id) nulls not distinct
 *
 * 한 D코드에 연결되면 같은 물질의 다른 D코드에도 연결한다 (buildSiblings).
 *
 * ────────────────────────────────────────────────
 * 적재를 막는 조건
 * ────────────────────────────────────────────────
 * 에러 / 수집데이터 없음 / 검수 대기 후보 가 하나라도 있으면 --commit 이어도 적재하지 않는다.
 *
 * 매칭 성분 0개 품목 자체는 막지 않는다. 비타민·한방처럼 DUR 규칙이 없는 성분만
 * 든 약이 실제로 있기 때문이다. 대신 그 품목에 대해 영문명 후보가 없어야 한다.
 * 후보가 있으면 검수 대기로 잡힌다.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA = join(process.cwd(), 'supabase/data');
const PRODUCTS_CSV = join(DATA, 'products-selected.csv');
const INGREDIENTS_DIR = join(DATA, 'drug-ingredients');
const DUR_ROOT = join(DATA, 'dur');
const OVERRIDES = join(DATA, 'mcode-overrides.json');
const REPORT_OUT = join(DATA, 'reports/medication-ingredients.json');
const CANDIDATES_OUT = join(DATA, 'reports/mcode-candidates.json');
const REVIEW_OUT = join(DATA, 'reports/mcode-review.json');
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const COMMIT = process.argv.includes('--commit');

const CONDITION_DIRS = ['pregnancy', 'age', 'elderly'] as const;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}

// medication_ingredients 는 types 재생성 전이므로 타입 없이 쓴다.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── 타입 ──────────────────────────────────────────────

type RawIngredient = {
  ITEM_SEQ: string;
  PRDUCT: string;
  MTRAL_SN: string;
  MTRAL_CODE: string | null;
  MTRAL_NM: string | null;
  QNT: string | null;
  INGD_UNIT_CD: string | null;
  MAIN_INGR_ENG: string | null;
  TAMT_SEQ: string | null;
  CPNT_CTNT_CONT: string | null;
};

type RawInteraction = {
  MIX_TYPE?: string;
  INGR_CODE: string;
  ORI?: string;
  MIX?: string; // 복합일 때 함께 든 성분 "[D000712]Ritonavir(리토나비르)"
  MIXTURE_MIX_TYPE?: string;
  MIXTURE_INGR_CODE: string;
  MIXTURE_ORI?: string;
  MIXTURE_MIX?: string;
};

type RawCondition = {
  MIX_TYPE?: string;
  INGR_CODE: string;
  ORI_INGR?: string;
  MIX_INGR?: string; // 복합일 때 함께 든 성분
};

type Overrides = {
  /** M코드 → D코드. 하나면 dcode, 여러 개면 dcodes */
  mappings: Record<string, { dcode?: string; dcodes?: string[]; note: string }>;
  /** 같은 물질인데 이름이 달라 자동으로 못 묶는 D코드 그룹 (카페인 / 카페인무수물) */
  siblings: { dcodes: string[]; note: string }[];
  /** 틀린 후보. 품목 단위로 기각 */
  dismissed: { item_seq: string; dcode: string; note: string }[];
};

const mappingDcodes = (m: Overrides['mappings'][string]) => [
  ...(m.dcodes ?? []),
  ...(m.dcode ? [m.dcode] : []),
];

type Ingredient = { id: string; code: string; name_ko: string; name_en: string | null };
type Medication = { id: string; item_seq: string; name: string };
type Target = { itemSeq: string; name: string; medicationId: string };

// ─── 유틸 ──────────────────────────────────────────────

/** 공백·줄바꿈 제거. DB 이름에 줄바꿈이 섞인 레코드가 있다. */
const norm = (s: string) => s.replace(/\s+/g, '');

const clean = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 함량 문자열 → 숫자. 빈 값은 null.
 * 천단위 쉼표("1,000")가 온다. 쉼표 자리가 천단위 규칙에 맞을 때만 제거한다.
 * 형식이 이상하면 NaN 을 돌려주고 호출부에서 에러로 처리한다.
 */
function parseAmount(qnt: string | null | undefined): number | null {
  if (qnt === null || qnt === undefined) return null;
  const v = qnt.trim();
  if (v === '') return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) return Number(v.replace(/,/g, ''));
  return NaN;
}

/** CSV 한 줄을 칸으로 자른다. "..." 로 묶인 칸 안의 쉼표는 구분자가 아니다. */
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

async function exists(path: string) {
  try {
    await access(path);
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

// ─── 1. 대상 품목 ──────────────────────────────────────

/**
 * products-selected.csv 의 의약품 행.
 * 제품명에 쉼표가 들어간 행은 DB name 자체가 그런 형태다(한 품목에 맛 변형 묶음). 쪼개지 않는다.
 * 식별자 칸이 채워져 있으면 item_seq 로 신뢰하고 이름 매칭보다 우선한다.
 */
async function loadCsvRows() {
  const text = await readFile(PRODUCTS_CSV, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const [header, ...rows] = lines;

  const cols = splitCsvLine(header).map((c) => c.trim());
  const iSource = cols.indexOf('출처');
  const iName = cols.indexOf('제품명');
  const iId = cols.indexOf('식별자');
  if (iSource === -1 || iName === -1 || iId === -1) {
    throw new Error(`CSV 헤더 이상: ${header}`);
  }

  const result: { name: string; itemSeq: string | null; line: number }[] = [];
  rows.forEach((line, idx) => {
    const fields = splitCsvLine(line);
    if (fields.length !== cols.length) {
      throw new Error(`CSV ${idx + 2}행 칸 수 이상 (${fields.length}/${cols.length}): ${line}`);
    }
    if (fields[iSource].trim() !== 'medications') return;

    // "※..." 이후는 사람이 붙인 메모
    const name = fields[iName].split('※')[0].trim();
    if (name === '') throw new Error(`CSV ${idx + 2}행 제품명이 비어 있음`);

    const id = fields[iId].trim();
    result.push({ name, itemSeq: id === '' ? null : id, line: idx + 2 });
  });
  return result;
}

async function resolveTargets(): Promise<Target[]> {
  const csvRows = await loadCsvRows();
  const meds = await selectAll<Medication>('medications', 'id, item_seq, name');
  console.log(`CSV 의약품 ${csvRows.length}행 / medications ${meds.length}건`);

  const bySeq = new Map<string, Medication[]>();
  const byName = new Map<string, Medication[]>();
  for (const m of meds) {
    bySeq.set(m.item_seq, [...(bySeq.get(m.item_seq) ?? []), m]);
    const k = norm(m.name);
    byName.set(k, [...(byName.get(k) ?? []), m]);
  }

  const targets: Target[] = [];
  const problems: string[] = [];

  for (const row of csvRows) {
    const hits = row.itemSeq !== null ? bySeq.get(row.itemSeq) : byName.get(norm(row.name));
    const how = row.itemSeq !== null ? `식별자 ${row.itemSeq}` : '이름';

    if (hits === undefined) {
      let msg = `${row.line}행 ${how} 로 못 찾음: ${row.name}`;
      if (row.itemSeq === null) {
        const head = norm(row.name.split('(')[0]).slice(0, 6);
        const cands = meds
          .filter((m) => norm(m.name).includes(head))
          .slice(0, 3)
          .map((m) => `${m.item_seq} ${m.name.replace(/\s+/g, ' ')}`);
        if (cands.length > 0) msg += `\n      후보: ${cands.join(' / ')}`;
      }
      problems.push(msg);
      continue;
    }
    if (hits.length > 1) {
      problems.push(
        `${row.line}행 ${how} 중복 ${hits.length}건: ${row.name} → ${hits.map((h) => h.item_seq).join(', ')}`
      );
      continue;
    }
    targets.push({ itemSeq: hits[0].item_seq, name: hits[0].name, medicationId: hits[0].id });
  }

  if (problems.length > 0) {
    console.error(`\n❌ 품목 식별 실패 ${problems.length}건`);
    problems.forEach((p) => console.error(`   ${p}`));
    console.error('\n   → CSV 식별자 칸에 item_seq 를 채우면 이름 매칭 없이 해결됩니다.');
    process.exit(1);
  }

  const unique = [...new Map(targets.map((t) => [t.itemSeq, t])).values()];
  if (unique.length !== targets.length) {
    console.log(`CSV 에 중복된 품목 ${targets.length - unique.length}건은 1건으로 처리`);
  }
  return unique;
}

// ─── 2. 원료·함량 ──────────────────────────────────────

async function loadIngredientRows(itemSeqs: Set<string>): Promise<Map<string, RawIngredient[]>> {
  const files = (await readdir(INGREDIENTS_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error(`${INGREDIENTS_DIR} 에 JSON 이 없습니다. 먼저 npm run fetch:drug-ingredients`);
  }

  const byItem = new Map<string, RawIngredient[]>();
  let scanned = 0;
  for (const file of files) {
    const items = JSON.parse(
      await readFile(join(INGREDIENTS_DIR, file), 'utf-8')
    ) as RawIngredient[];
    scanned += items.length;
    for (const item of items) {
      const seq = item.ITEM_SEQ?.trim();
      if (seq === undefined || !itemSeqs.has(seq)) continue;
      byItem.set(seq, [...(byItem.get(seq) ?? []), item]);
    }
  }
  console.log(`수집 파일 ${files.length}개 / ${scanned}행 스캔 → 대상 품목 ${byItem.size}건 발견`);
  return byItem;
}

// ─── 3. M코드 → D코드 ──────────────────────────────────

function unwrap<T>(raw: unknown[]): T[] {
  return raw.map((r) => {
    const obj = r as Record<string, unknown>;
    return (obj?.item ?? obj) as T;
  });
}

async function readDurDir<T>(dir: string): Promise<T[]> {
  const path = join(DUR_ROOT, dir);
  const files = (await readdir(path)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${path} 에 JSON 이 없습니다.`);
  const out: T[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(path, file), 'utf-8')) as unknown[];
    out.push(...unwrap<T>(raw));
  }
  return out;
}

/** "[M040353]아세트아미노펜/[M082309]..." → ["M040353", "M082309"] */
const extractCodes = (ori: string) => [...ori.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());

/** "[M050058]구아이페네신/[M040353]아세트아미노펜" → [{code, name}, ...] */
const parseOri = (ori: string) =>
  ori
    .split(/\/(?=\[)/)
    .map((e) => e.match(/^\[([^\]]+)\](.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ code: m[1].trim(), name: m[2].trim() }));

/** "[D000232]Aescin(에스신)/[D000764]..." → ["D000232", "D000764"] */
const extractDcodes = (mix: string | null) =>
  mix === null ? [] : [...mix.matchAll(/\[(D\d+)\]/g)].map((m) => m[1]);

/**
 * M코드 → D코드 매핑.
 *
 * 단일 행: ORI 의 M코드는 전부 그 성분 것이다. 바로 확정.
 *
 * 복합 행: ORI 에 복합제에 함께 든 성분들의 M코드가 섞여 있다.
 *   "이 M코드는 {본 성분 + MIX 성분들} 중 하나의 것" 이라는 정보만 준다.
 *   같은 M코드가 나오는 복합 행들의 후보 집합을 교집합하면 좁혀진다.
 *     행1  D000493 구아이페네신 + [아세트아미노펜]      → {D000493, D000147}
 *     행2  D001098 노스카핀 + [구아이페네신, ...]       → {D001098, D000493, ...}
 *     교집합 → {D000493}  확정
 *   하나로 떨어질 때만 쓰고, 여러 개 남으면 확정하지 않는다.
 *
 *   교집합만으론 안 좁혀지는 경우가 있다. 두 행 모두 구아이페네신과 아세트아미노펜을
 *   함께 담으면 {D000493, D000147} 에서 멈춘다. 그래서 행마다 먼저
 *   ORI 항목의 원료명("[M050058]구아이페네신")에 후보 성분명이 들어 있는지 본다.
 *   후보 2~3개 중 하나만 들어 있으면 그 행에서는 그 성분으로 좁힌다.
 *   전체 성분 대상 이름 검색이 아니라 한 행의 몇 개 안 되는 후보 안에서 고르는 것이다.
 *   (덱스클로르페니라민 ⊃ 클로르페니라민 처럼 둘 다 들어 있으면 좁히지 않는다)
 *
 * 단일 근거가 있으면 그것을 우선하되, 복합 교집합과 모순되면 충돌로 남긴다.
 */
async function buildCodeMapping(dToName: Map<string, string>) {
  const single = new Map<string, Set<string>>();
  const combo = new Map<string, Set<string>>(); // M코드 → 후보 D코드 교집합

  const add = (
    mixType: string | null,
    dcode: string | null,
    ori: string | null,
    mix: string | null
  ) => {
    if (dcode === null || ori === null) return;

    if (mixType === '단일') {
      for (const m of extractCodes(ori)) {
        const s = single.get(m);
        if (s === undefined) single.set(m, new Set([dcode]));
        else s.add(dcode);
      }
      return;
    }
    if (mixType !== '복합') return;

    const group = [dcode, ...extractDcodes(mix)];
    for (const { code: m, name } of parseOri(ori)) {
      // 이 행 안에서 원료명으로 좁히기
      const byName = group.filter((d) => {
        const dn = dToName.get(d);
        return dn !== undefined && dn !== '' && norm(name).includes(norm(dn));
      });
      const local = new Set(byName.length === 1 ? byName : group);

      const prev = combo.get(m);
      combo.set(m, prev === undefined ? local : new Set([...prev].filter((d) => local.has(d))));
    }
  };

  for (const r of await readDurDir<RawInteraction>('interaction')) {
    add(clean(r.MIX_TYPE), clean(r.INGR_CODE), clean(r.ORI), clean(r.MIX));
    add(
      clean(r.MIXTURE_MIX_TYPE),
      clean(r.MIXTURE_INGR_CODE),
      clean(r.MIXTURE_ORI),
      clean(r.MIXTURE_MIX)
    );
  }
  for (const dir of CONDITION_DIRS) {
    for (const r of await readDurDir<RawCondition>(dir)) {
      add(clean(r.MIX_TYPE), clean(r.INGR_CODE), clean(r.ORI_INGR), clean(r.MIX_INGR));
    }
  }

  // 같은 물질에 D코드가 여러 개인 경우가 있다 (피록시캄 D000309 / D000983, 둘 다 규칙 보유).
  // 단일 행은 그 성분 원료만 담으므로, 한 M코드가 단일 행 여러 D코드에서 나오면 전부 맞다.
  const map = new Map<string, Set<string>>();
  const conflicts: string[] = [];
  let fromSingle = 0;
  let fromCombo = 0;
  let multi = 0;
  let comboAmbiguous = 0;

  for (const m of new Set([...single.keys(), ...combo.keys()])) {
    const s = single.get(m);
    const c = combo.get(m);

    if (s !== undefined) {
      // 복합 근거가 있는데 단일 D코드 중 하나도 겹치지 않으면 모순
      if (c !== undefined && ![...s].some((d) => c.has(d))) {
        conflicts.push(`${m} 단일 {${[...s].join(', ')}} vs 복합 교집합 {${[...c].join(', ')}}`);
        continue;
      }
      map.set(m, new Set(s));
      fromSingle++;
      if (s.size > 1) multi++;
      continue;
    }

    if (c !== undefined && c.size === 1) {
      map.set(m, new Set(c));
      fromCombo++;
    } else if (c !== undefined && c.size > 1) {
      comboAmbiguous++;
    } else if (c !== undefined && c.size === 0) {
      conflicts.push(`${m} 복합 행들의 교집합이 비어 있음`);
    }
  }

  console.log(
    `코드 매핑 ${map.size}개 (단일 ${fromSingle} / 복합 교집합 ${fromCombo} / D코드 여러 개 ${multi})` +
      ` / 복합 미확정 ${comboAmbiguous}` +
      (conflicts.length > 0 ? ` / 충돌 ${conflicts.length}` : '')
  );
  return { map, conflicts };
}

/**
 * 수동 매핑 파일. 없으면 빈 파일을 만들어 둔다.
 * 코드 매핑과 충돌하거나 없는 D코드를 가리키면 멈춘다.
 */
async function loadOverrides(dToIng: Map<string, Ingredient>): Promise<Overrides> {
  if (!(await exists(OVERRIDES))) {
    const empty: Overrides = { mappings: {}, siblings: [], dismissed: [] };
    await writeFile(OVERRIDES, JSON.stringify(empty, null, 2) + '\n', 'utf-8');
    console.log(`수동 매핑 파일이 없어 빈 파일을 만들었습니다: ${OVERRIDES}`);
    return empty;
  }

  const o = JSON.parse(await readFile(OVERRIDES, 'utf-8')) as Overrides;
  if (typeof o.mappings !== 'object' || !Array.isArray(o.siblings) || !Array.isArray(o.dismissed)) {
    throw new Error(
      `${OVERRIDES} 형식 이상. { "mappings": {}, "siblings": [], "dismissed": [] } 여야 합니다.`
    );
  }

  const problems: string[] = [];
  // 수동 매핑은 코드 매핑에 더해진다(합집합). 같은 물질에 D코드가 여러 개일 수 있으므로 충돌로 보지 않는다.
  for (const [mcode, m] of Object.entries(o.mappings)) {
    const ds = mappingDcodes(m);
    if (ds.length === 0) problems.push(`mappings.${mcode}: dcode 또는 dcodes 가 없음`);
    for (const d of ds)
      if (!dToIng.has(d)) problems.push(`mappings.${mcode} → ${d}: ingredients 에 없는 D코드`);
  }
  for (const g of o.siblings) {
    if (g.dcodes.length < 2) problems.push(`siblings: 2개 이상이어야 함 (${g.dcodes.join(', ')})`);
    for (const d of g.dcodes)
      if (!dToIng.has(d)) problems.push(`siblings → ${d}: ingredients 에 없는 D코드`);
  }
  if (problems.length > 0) {
    console.error('\n❌ 수동 매핑 파일 오류');
    problems.forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }

  console.log(
    `수동 매핑 ${Object.keys(o.mappings).length}개 / 동일 물질 그룹 ${o.siblings.length}개 / 기각 ${o.dismissed.length}개`
  );
  return o;
}

// ─── 동일 물질 D코드 묶기 ─────────────────────────────

/**
 * 같은 물질에 D코드가 여러 개인 경우 서로 묶는다. 하나에 연결되면 전부 연결한다.
 *   자동: 영문명 또는 한글명이 완전히 같으면 같은 물질 (나프록센 D000195 / D000982)
 *   선언: 이름이 달라 자동으로 못 묶는 것은 overrides.siblings (카페인 / 카페인무수물)
 * 대소문자·공백만 무시한다. 포함 관계(피리독신 ⊂ 피리독신염산염)는 자동으로 묶지 않는다.
 */
function buildSiblings(
  ings: Ingredient[],
  declared: Overrides['siblings']
): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byKey = new Map<string, string>();
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  for (const i of ings) {
    for (const k of [
      i.name_en ? `en:${key(i.name_en)}` : null,
      i.name_ko ? `ko:${key(i.name_ko)}` : null,
    ]) {
      if (k === null) continue;
      const first = byKey.get(k);
      if (first === undefined) byKey.set(k, i.code);
      else union(first, i.code);
    }
  }
  for (const g of declared) for (const d of g.dcodes.slice(1)) union(g.dcodes[0], d);

  const groups = new Map<string, Set<string>>();
  for (const i of ings) {
    const r = find(i.code);
    const g = groups.get(r) ?? new Set<string>();
    g.add(i.code);
    groups.set(r, g);
  }
  const out = new Map<string, Set<string>>();
  for (const g of groups.values()) if (g.size > 1) for (const d of g) out.set(d, g);
  return out;
}

// ─── 4. 영문명 후보 ────────────────────────────────────

/** name_en 을 단어 경계로 찾는 정규식. 예: "Xylometazoline" ⊂ "Xylometazoline Hydrochloride" */
function buildEnglishMatchers(ings: Ingredient[]) {
  return ings
    .filter((i) => i.name_en !== null && i.name_en.trim().length >= 4)
    .map((i) => ({ ing: i, re: new RegExp(`\\b${escapeRegExp(i.name_en!.trim())}\\b`, 'i') }));
}

// ─── main ──────────────────────────────────────────────

async function main() {
  const targets = await resolveTargets();
  console.log(`대상 품목 ${targets.length}건`);

  const byItem = await loadIngredientRows(new Set(targets.map((t) => t.itemSeq)));
  const ings = await selectAll<Ingredient>('ingredients', 'id, code, name_ko, name_en');
  const dToIng = new Map(ings.map((i) => [i.code, i]));
  console.log(`ingredients ${ings.length}건`);

  const { map: codeMap, conflicts: codeConflicts } = await buildCodeMapping(
    new Map(ings.map((i) => [i.code, i.name_ko]))
  );
  const overrides = await loadOverrides(dToIng);
  const englishMatchers = buildEnglishMatchers(ings);

  const dismissed = new Set(overrides.dismissed.map((d) => `${d.item_seq}|${d.dcode}`));

  const siblings = buildSiblings(ings, overrides.siblings);
  console.log(`동일 물질로 묶인 D코드 ${siblings.size}개`);

  const resolve = (mcode: string): { dcodes: string[]; viaOverride: boolean } => {
    const set = new Set(codeMap.get(mcode) ?? []);
    const manual = overrides.mappings[mcode];
    const before = set.size;
    if (manual !== undefined) for (const d of mappingDcodes(manual)) set.add(d);
    const viaOverride = set.size > before;
    for (const d of [...set]) for (const sib of siblings.get(d) ?? []) set.add(sib);
    return { dcodes: [...set].sort(), viaOverride };
  };

  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const noData: string[] = [];
  const zeroMatch: string[] = [];
  const multiTamt: string[] = [];
  const unmatched: { item_seq: string; name: string; mtral_code: string; mtral_nm: string }[] = [];
  type Candidate = { dcode: string; name_ko: string; name_en: string | null; found_in: string };
  type Pending = {
    item_seq: string;
    product: string;
    unmatched_mtral: { mtral_code: string; mtral_nm: string }[];
    candidates: Candidate[];
    how_to_resolve: string;
  };
  const pending: Pending[] = [];
  let viaCode = 0;
  let viaOverride = 0;
  const multiLinked: string[] = [];

  for (const target of targets) {
    const label = `${target.itemSeq} ${target.name.replace(/\s+/g, ' ')}`;
    const raws = byItem.get(target.itemSeq);
    if (raws === undefined) {
      noData.push(label);
      continue;
    }

    const tamtSeqs = new Set(raws.map((r) => clean(r.TAMT_SEQ) ?? '1'));
    if (tamtSeqs.size > 1) multiTamt.push(`${label} (TAMT_SEQ ${[...tamtSeqs].sort().join(',')})`);

    // (성분명, 총량 기준) 단위로 묶는다. 같은 기준 안에서 같은 성분이 다른 함량이면 판단하지 않는다.
    const grouped = new Map<string, RawIngredient>();
    for (const raw of raws) {
      const name = clean(raw.MTRAL_NM);
      const unit = clean(raw.INGD_UNIT_CD);
      const tamt = clean(raw.TAMT_SEQ) ?? '1';
      const amount = parseAmount(raw.QNT);

      if (name === null) {
        errors.push(`성분명 없음: ${label} (MTRAL_SN ${raw.MTRAL_SN})`);
        continue;
      }
      if (unit === null) {
        errors.push(`단위 없음: ${label} / ${name}`);
        continue;
      }
      if (Number.isNaN(amount)) {
        errors.push(`함량 형식 이상: ${label} / ${name} → "${raw.QNT}"`);
        continue;
      }

      const key = `${name}|${tamt}`;
      const prev = grouped.get(key);
      if (prev === undefined) {
        grouped.set(key, raw);
        continue;
      }
      if (parseAmount(prev.QNT) !== amount || clean(prev.INGD_UNIT_CD) !== unit) {
        errors.push(
          `같은 기준(TAMT_SEQ ${tamt}) 안에서 함량이 다른 중복: ${label} / ${name} ` +
            `(${prev.QNT}${prev.INGD_UNIT_CD} [${prev.CPNT_CTNT_CONT ?? ''}] vs ${raw.QNT}${unit} [${raw.CPNT_CTNT_CONT ?? ''}])`
        );
      }
    }

    const matchedDcodes = new Set<string>();
    const itemUnmatched: { mtral_code: string; mtral_nm: string }[] = [];

    for (const raw of grouped.values()) {
      const name = clean(raw.MTRAL_NM)!;
      const mcode = clean(raw.MTRAL_CODE) ?? '';
      const { dcodes, viaOverride: byOverride } =
        mcode === '' ? { dcodes: [], viaOverride: false } : resolve(mcode);

      const missing = dcodes.filter((d) => !dToIng.has(d));
      if (missing.length > 0) {
        errors.push(
          `D코드가 ingredients 에 없음: ${label} / ${mcode} → ${missing.join(', ')} ${name}`
        );
        continue;
      }

      const base = {
        medication_id: target.medicationId,
        raw_name: name,
        amount: parseAmount(raw.QNT),
        unit: clean(raw.INGD_UNIT_CD)!,
        tamt_seq: clean(raw.TAMT_SEQ) ?? '1',
        amount_basis: clean(raw.CPNT_CTNT_CONT),
      };

      if (dcodes.length === 0) {
        itemUnmatched.push({ mtral_code: mcode, mtral_nm: name });
        unmatched.push({
          item_seq: target.itemSeq,
          name: label,
          mtral_code: mcode,
          mtral_nm: name,
        });
        rows.push({ ...base, ingredient_id: null });
        continue;
      }

      if (byOverride) viaOverride++;
      else viaCode++;
      if (dcodes.length > 1) multiLinked.push(`${label} / ${name} → ${dcodes.join(', ')}`);

      // 같은 물질에 D코드가 여러 개면 전부 연결한다. 하나만 고르면 다른 코드의 규칙을 놓친다.
      for (const d of dcodes) {
        matchedDcodes.add(d);
        rows.push({ ...base, ingredient_id: dToIng.get(d)!.id });
      }
    }

    if (matchedDcodes.size === 0) zeroMatch.push(label);

    // 미매칭 원료가 있는 품목만 영문명 후보를 찾는다.
    if (itemUnmatched.length === 0) continue;

    const englishParts = [
      ...new Set(
        raws
          .map((r) => clean(r.MAIN_INGR_ENG))
          .filter((v): v is string => v !== null)
          .flatMap((v) => v.split('/').map((p) => p.trim()))
          .filter((p) => p !== '')
      ),
    ];

    const candidates = englishMatchers
      .filter(({ ing }) => !matchedDcodes.has(ing.code))
      .filter(({ ing }) => !dismissed.has(`${target.itemSeq}|${ing.code}`))
      .map(({ ing, re }) => ({ ing, hitIn: englishParts.find((p) => re.test(p)) }))
      .filter((c): c is { ing: Ingredient; hitIn: string } => c.hitIn !== undefined)
      .map(({ ing, hitIn }) => ({
        dcode: ing.code,
        name_ko: ing.name_ko,
        name_en: ing.name_en,
        found_in: hitIn,
      }));

    if (candidates.length > 0) {
      pending.push({
        item_seq: target.itemSeq,
        product: target.name.replace(/\s+/g, ' '),
        // 총량 기준이 여러 개면 같은 원료가 반복되므로 보여줄 때만 합친다
        unmatched_mtral: [...new Map(itemUnmatched.map((u) => [u.mtral_code, u])).values()],
        candidates,
        how_to_resolve:
          '의약품안전나라에서 제품 성분 확인 → 맞으면 mappings 에 "M코드": { "dcode", "note" } 추가 / ' +
          '아니면 dismissed 에 { item_seq, dcode, note } 추가',
      });
    }
  }

  // ── 원료(M코드) 단위 검수 파일 ─────────────────────────
  // 품목마다 같은 판단(카페인무수물 = 카페인)을 반복하지 않도록 M코드로 묶는다.
  //   신호 1 영문: 제품 영문 성분명에 후보 name_en 이 단어로 있음 (후보 추출 조건)
  //   신호 2 한글: 원료명(MTRAL_NM)에 후보 name_ko 가 들어 있음
  // 한 품목 안에서 후보 하나당 신호 2 를 만족하는 원료가 정확히 하나면 그 짝을 "추천" 으로 본다.
  // 같은 M코드가 품목마다 다른 D코드를 추천받으면 추천하지 않는다.
  const votes = new Map<
    string,
    { mtral_nm: string; dcodes: Map<string, Candidate>; products: Set<string> }
  >();
  const manual: {
    item_seq: string;
    product: string;
    candidate: Candidate;
    unmatched_mtral: Pending['unmatched_mtral'];
    reason: string;
  }[] = [];

  for (const p of pending) {
    for (const c of p.candidates) {
      const hits = p.unmatched_mtral.filter(
        (u) => c.name_ko !== '' && norm(u.mtral_nm).includes(norm(c.name_ko))
      );
      if (hits.length !== 1) {
        manual.push({
          item_seq: p.item_seq,
          product: p.product,
          candidate: c,
          unmatched_mtral: p.unmatched_mtral,
          reason:
            hits.length === 0
              ? '원료명에 성분명이 없음 (표기 차이 또는 오탐)'
              : `원료명 ${hits.length}개가 성분명을 포함`,
        });
        continue;
      }
      const u = hits[0];
      const v = votes.get(u.mtral_code) ?? {
        mtral_nm: u.mtral_nm,
        dcodes: new Map(),
        products: new Set(),
      };
      v.dcodes.set(c.dcode, c);
      v.products.add(`${p.item_seq} ${p.product}`);
      votes.set(u.mtral_code, v);
    }
  }

  const suggested: Record<string, { dcode: string; note: string }> = {};
  const suggestedView: unknown[] = [];
  for (const [mcode, v] of [...votes].sort((a, b) => b[1].products.size - a[1].products.size)) {
    if (v.dcodes.size !== 1) {
      for (const c of v.dcodes.values()) {
        manual.push({
          item_seq: '(여러 품목)',
          product: [...v.products].join(' / '),
          candidate: c,
          unmatched_mtral: [{ mtral_code: mcode, mtral_nm: v.mtral_nm }],
          reason: `같은 원료가 품목마다 다른 성분을 추천받음: ${[...v.dcodes.keys()].join(', ')}`,
        });
      }
      continue;
    }
    const c = [...v.dcodes.values()][0];
    suggested[mcode] = {
      dcode: c.dcode,
      note: `${v.mtral_nm} → ${c.name_ko} (${c.name_en ?? ''})`,
    };
    suggestedView.push({
      mcode,
      mtral_nm: v.mtral_nm,
      dcode: c.dcode,
      name_ko: c.name_ko,
      name_en: c.name_en,
      product_count: v.products.size,
    });
  }

  await mkdir(dirname(REVIEW_OUT), { recursive: true });
  await writeFile(
    REVIEW_OUT,
    JSON.stringify(
      {
        how_to_use: [
          '1. suggested_list 를 훑어서 원료명과 성분명이 같은 물질인지 본다 (카페인무수물 = 카페인)',
          '2. 이상한 줄은 suggested_mappings 에서 지운다',
          '3. suggested_mappings 를 mcode-overrides.json 의 mappings 안에 붙인다',
          '4. manual 은 의약품안전나라에서 제품 성분을 확인하고 mappings 또는 dismissed 에 직접 추가한다',
        ],
        suggested_list: suggestedView,
        suggested_mappings: suggested,
        manual,
      },
      null,
      2
    ),
    'utf-8'
  );

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
        viaCode,
        viaOverride,
        errors,
        noData,
        zeroMatch,
        multiTamt,
        multiLinked,
        codeConflicts,
        unmatched,
      },
      null,
      2
    ),
    'utf-8'
  );
  await writeFile(CANDIDATES_OUT, JSON.stringify(pending, null, 2), 'utf-8');

  console.log(`\n품목 ${targets.length} / 적재 행 ${rows.length}`);
  console.log(
    `  연결 행 ${matchedRows} (원료 기준 코드 ${viaCode} / 수동 ${viaOverride}, D코드 여러 개 ${multiLinked.length}) / 미매칭 원료 ${unmatched.length}`
  );
  console.log(`  에러 ${errors.length} / 수집데이터 없음 ${noData.length}`);
  console.log(
    `  검수 대기 품목 ${pending.length} / 매칭0 품목 ${zeroMatch.length} / 총량 기준 여러 개 ${multiTamt.length}`
  );
  console.log(`리포트: ${REPORT_OUT}`);
  console.log(`후보:   ${CANDIDATES_OUT}`);
  console.log(
    `검수:   ${REVIEW_OUT}  (추천 ${Object.keys(suggested).length}개 / 수동 확인 ${manual.length}건)`
  );

  if (errors.length > 0 || noData.length > 0 || pending.length > 0) {
    console.error('\n❌ 적재하지 않습니다.');
    errors.slice(0, 5).forEach((e) => console.error(`   ${e}`));
    noData.slice(0, 5).forEach((n) => console.error(`   수집데이터 없음: ${n}`));
    if (pending.length > 0)
      console.error(`   검수 대기 ${pending.length}품목 → mcode-review.json 확인`);
    process.exit(1);
  }

  if (!COMMIT) {
    console.log('\n(dry-run) 적재하려면 -- --commit');
    return;
  }

  // upsert 대신 "대상 품목 행 삭제 → 삽입".
  // 매핑이 바뀌면 예전 null 행(미매칭)이 키가 달라 남는다. 품목 단위로 갈아끼워야 깨끗하다.
  // 중간에 실패하면 일부 품목이 비어 있을 수 있다. 다시 실행하면 복구된다.
  const medIds = targets.map((t) => t.medicationId);
  for (let i = 0; i < medIds.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from('medication_ingredients')
      .delete()
      .in('medication_id', medIds.slice(i, i + BATCH_SIZE));
    if (error) {
      console.error('  기존 행 삭제 실패:', error.message);
      process.exit(1);
    }
  }
  console.log(`  대상 품목 ${medIds.length}건 기존 행 삭제`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('medication_ingredients').insert(batch);
    if (error) {
      console.error(`  ${i + 1}~${i + batch.length}번째 실패:`, error.message);
      console.error('  다시 실행하면 대상 품목을 지우고 처음부터 넣습니다.');
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

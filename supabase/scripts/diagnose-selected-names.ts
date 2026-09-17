/**
 * #76 진단: products-selected.csv 의 의약품 제품명이 DB/파일과 왜 안 맞는지 분류한다.
 *
 * 실행: npx tsx supabase/scripts/diagnose-selected-names.ts
 *
 * 적재하지 않는다. 읽기만 한다.
 *
 * 분류
 *   A. material-names.json 에 있음            → #76 진행 가능
 *   B. medications 에 있으나 MATERIAL_NAME 없음 → dur-items 에 없는 품목(DUR 규칙 없음)
 *   C. medications 에 없음                    → 이름 표기 차이 또는 DB 에 없는 품목
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCTS_CSV = join(process.cwd(), 'supabase/data/products-selected.csv');
const MATERIAL_NAMES = join(process.cwd(), 'supabase/data/material-names.json');
const PAGE_SIZE = 1000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
  fields.push(field);
  return fields;
}

/** 표기 흔들림 흡수용: 공백·줄바꿈 제거 */
const norm = (s: string) => s.replace(/\s+/g, '');

async function loadCsvNames(): Promise<string[]> {
  const text = await readFile(PRODUCTS_CSV, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const [header, ...rows] = lines;
  const cols = splitCsvLine(header).map((c) => c.trim());
  const iSource = cols.indexOf('출처');
  const iName = cols.indexOf('제품명');

  const names: string[] = [];
  for (const line of rows) {
    const f = splitCsvLine(line);
    if (f.length !== cols.length) continue;
    if (f[iSource].trim() !== 'medications') continue;
    for (const part of f[iName].split(',').map((p) => p.trim())) {
      if (part !== '') names.push(part);
    }
  }
  return [...new Set(names)];
}

async function main() {
  const csvNames = await loadCsvNames();

  const materials: { item_seq: string; name: string }[] = JSON.parse(
    await readFile(MATERIAL_NAMES, 'utf-8')
  );
  const materialNames = new Set(materials.map((m) => norm(m.name)));

  // medications 전체
  const meds: { item_seq: string; name: string; etc_otc_code: string | null }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('medications')
      .select('item_seq, name, etc_otc_code')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    meds.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`medications ${meds.length}건 / material-names ${materials.length}건`);

  const medByNorm = new Map<string, typeof meds>();
  for (const m of meds) {
    const k = norm(m.name);
    medByNorm.set(k, [...(medByNorm.get(k) ?? []), m]);
  }

  const A: string[] = [];
  const B: string[] = [];
  const C: { name: string; candidates: string[] }[] = [];

  for (const name of csvNames) {
    const key = norm(name);

    if (materialNames.has(key)) {
      A.push(name);
      continue;
    }

    const hits = medByNorm.get(key);
    if (hits !== undefined) {
      B.push(
        `${name} [${hits.map((h) => `${h.item_seq} etc_otc=${h.etc_otc_code ?? 'null'}`).join(' / ')}]`
      );
      continue;
    }

    // 이름 앞부분(괄호 앞)으로 후보 찾기
    const head = name.split('(')[0].slice(0, 6);
    const candidates = meds
      .filter((m) => norm(m.name).includes(norm(head)))
      .slice(0, 3)
      .map((m) => `${m.item_seq} ${m.name}`);
    C.push({ name, candidates });
  }

  console.log(`\nCSV 의약품 제품명 ${csvNames.length}건`);
  console.log(`  A. MATERIAL_NAME 있음      ${A.length}`);
  console.log(`  B. DB 에 있으나 성분정보 없음 ${B.length}`);
  console.log(`  C. DB 에 없음              ${C.length}`);

  console.log('\n── B. DB 에 있으나 MATERIAL_NAME 없음 ──');
  B.forEach((b) => console.log(`  ${b}`));

  console.log('\n── C. DB 에 이름이 없음 (후보 최대 3개) ──');
  C.forEach((c) => {
    console.log(`  ${c.name}`);
    c.candidates.forEach((cand) => console.log(`      ? ${cand}`));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

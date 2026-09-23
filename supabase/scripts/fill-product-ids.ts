/**
 * #15 products-selected.csv 의 식별자 칸 채우기
 *
 * 실행:
 *   dry-run:  npm run fill:product-ids
 *   저장:     npm run fill:product-ids -- --write
 *
 * ────────────────────────────────────────────────
 * 왜 필요한가
 * ────────────────────────────────────────────────
 * 의약품 행의 식별자 칸이 비어 있어 제품명으로 medications 를 찾고 있다.
 * 이름 매칭은 제품명 표기가 바뀌거나 DB 가 갱신되면 깨진다.
 * item_seq 를 CSV 에 박아두면 이후 seed 는 이름을 보지 않는다.
 *
 * ────────────────────────────────────────────────
 * 규칙
 * ────────────────────────────────────────────────
 * - 이미 채워진 칸은 건드리지 않는다 (건기식 22개, 수동 입력한 케펜텍)
 * - 이름으로 0건이거나 2건 이상이면 채우지 않고 멈춘다. 잘못 채우면
 *   엉뚱한 약의 성분으로 DUR 검사가 돌아간다
 * - --write 없이는 결과만 보여준다
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRODUCTS_CSV = join(process.cwd(), 'supabase/data/products-selected.csv');
const PAGE_SIZE = 1000;
const WRITE = process.argv.includes('--write');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Medication = { id: string; item_seq: string; name: string };

/** 공백·줄바꿈 제거. DB 이름에 줄바꿈이 섞인 레코드가 있다. */
const norm = (s: string) => s.replace(/\s+/g, '');

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

/** 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다 */
function toCsvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function loadMedications(): Promise<Medication[]> {
  const all: Medication[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('medications')
      .select('id, item_seq, name')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`medications 조회 실패: ${error.message}`);
    all.push(...(data as Medication[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  const text = await readFile(PRODUCTS_CSV, 'utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  const header = splitCsvLine(lines[0]).map((c) => c.trim());
  const iSource = header.indexOf('출처');
  const iName = header.indexOf('제품명');
  const iId = header.indexOf('식별자');
  if (iSource === -1 || iName === -1 || iId === -1) throw new Error(`CSV 헤더 이상: ${lines[0]}`);

  const meds = await loadMedications();
  const byName = new Map<string, Medication[]>();
  for (const m of meds) {
    const k = norm(m.name);
    byName.set(k, [...(byName.get(k) ?? []), m]);
  }
  console.log(`medications ${meds.length}건`);

  const out: string[] = [lines[0]];
  const filled: string[] = [];
  const problems: string[] = [];
  let kept = 0;
  let skipped = 0;

  for (let idx = 1; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim() === '') {
      out.push(line);
      continue;
    }

    const fields = splitCsvLine(line);
    if (fields.length !== header.length) {
      throw new Error(`CSV ${idx + 1}행 칸 수 이상 (${fields.length}/${header.length}): ${line}`);
    }

    // 의약품이 아니거나 이미 채워진 행은 그대로
    if (fields[iSource].trim() !== 'medications' || fields[iId].trim() !== '') {
      if (fields[iId].trim() !== '') kept++;
      else skipped++;
      out.push(line);
      continue;
    }

    // "※..." 이후는 사람이 붙인 메모
    const name = fields[iName].split('※')[0].trim();
    const hits = byName.get(norm(name));

    if (hits === undefined || hits.length > 1) {
      problems.push(
        `${idx + 1}행 ${hits === undefined ? '못 찾음' : `${hits.length}건 중복`}: ${name}` +
          (hits
            ? `\n      ${hits.map((h) => `${h.item_seq} ${h.name.replace(/\s+/g, ' ')}`).join(' / ')}`
            : '')
      );
      out.push(line);
      continue;
    }

    fields[iId] = hits[0].item_seq;
    filled.push(`${hits[0].item_seq}  ${name}`);
    out.push(fields.map(toCsvField).join(','));
  }

  console.log(`\n채울 행 ${filled.length} / 이미 채워진 행 ${kept} / 의약품 아님 ${skipped}`);
  filled.slice(0, 5).forEach((f) => console.log(`   ${f}`));
  if (filled.length > 5) console.log(`   ... 외 ${filled.length - 5}건`);

  if (problems.length > 0) {
    console.error(`\n❌ 식별 실패 ${problems.length}건 — 저장하지 않습니다`);
    problems.forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }

  if (!WRITE) {
    console.log('\n(dry-run) 저장하려면 -- --write');
    return;
  }

  await writeFile(PRODUCTS_CSV, out.join(eol), 'utf-8');
  console.log(`\n✅ ${PRODUCTS_CSV} 저장`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

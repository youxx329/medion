/**
 * 의약품 제품 주성분 상세정보 수집 → 로컬 JSON 저장
 *
 * 실행: npm run fetch:drug-ingredients
 *
 * 126,871건 / 1,269페이지(100건 기준). 지금까지 중 가장 크다.
 *
 * ────────────────────────────────────────────────
 * 이 API 를 쓰는 이유
 * ────────────────────────────────────────────────
 * dur-items 의 MATERIAL_NAME 은 일반의약품 커버리지가 19.5% 라 부적합했다.
 * 이 오퍼레이션은 성분 1건당 1행으로 필드가 분리돼 있고
 * MTRAL_CODE 로 ingredients.code 와 직접 매칭된다. (경위는 #76)
 *
 * ────────────────────────────────────────────────
 * 전체를 받는 이유
 * ────────────────────────────────────────────────
 * item_seq 필터 파라미터가 없다. 지원 파라미터는
 * Prduct(제품명) / Entrps(업체명) / Bizrno / Entrps_prmisn_no 뿐이고,
 * 제품명은 DB 에 여러 제품이 쉼표로 묶인 레코드가 있어 필터 키로 쓸 수 없다.
 * 전체를 받아 ITEM_SEQ 로 거른다. 한 번 받아두면 상품 추가 시 재수집 불필요.
 *
 * ★ 응답 구조는 dur-items 와 같다: body.items[] (한 겹 더 없음)
 */

import { config } from 'dotenv';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
config({ path: '.env.local' });

const API_KEY = process.env.MFDS_API_KEY;

// 서비스는 07, 오퍼레이션은 07. 상세조회(getDrugPrdtPrmsnDtlInq06)는 System Error 로 응답 없음.
// 규칙이 없으므로 반드시 data.go.kr 문서에서 확인할 것.
const BASE_URL = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07';
const OPERATION = 'getDrugPrdtMcpnDtlInq07';

const OUT_DIR = join(process.cwd(), 'supabase/data/drug-ingredients');
const ROWS_PER_PAGE = 100;
const EXPECT_COUNT = 126871; // 2026.09 확인

if (!API_KEY) {
  console.error('MFDS_API_KEY 가 .env.local 에 없습니다.');
  process.exit(1);
}

type ApiResponse = {
  header: { resultCode: string; resultMsg: string };
  body: {
    pageNo: number;
    totalCount: number;
    numOfRows: number;
    items: unknown;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(pageNo: number): Promise<ApiResponse> {
  const params = new URLSearchParams({
    ServiceKey: API_KEY!,
    pageNo: String(pageNo),
    numOfRows: String(ROWS_PER_PAGE),
    type: 'json',
  });

  const res = await fetch(`${BASE_URL}/${OPERATION}?${params}`);
  const text = await res.text();

  if (text.trimStart().startsWith('<')) {
    throw new Error(`XML 응답 (인증키/트래픽 확인)\n${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text) as ApiResponse;

  if (json.header?.resultCode !== '00') {
    throw new Error(`API 오류: ${json.header?.resultMsg}`);
  }

  return json;
}

/** 결과가 1건이면 배열이 아닌 객체로 오는 케이스 방어 (원본이 XML) */
function toArray(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') return [items];
  return [];
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const existing = new Set((await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')));

  const first = await fetchPage(1);
  const totalCount = first.body.totalCount;
  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE);

  const mismatch = totalCount !== EXPECT_COUNT ? `  ⚠️ 문서 기록 ${EXPECT_COUNT}건과 다름` : '';
  console.log(`전체 ${totalCount}건 / ${totalPages}페이지${mismatch}`);

  if (existing.size > 0) {
    console.log(`이미 받은 페이지 ${existing.size}개는 건너뜁니다.`);
  }
  console.log('일일 트래픽 한도로 중단될 수 있습니다. 다시 실행하면 이어받습니다.\n');

  for (let page = 1; page <= totalPages; page++) {
    const filename = `page-${String(page).padStart(4, '0')}.json`;
    if (existing.has(filename)) continue;

    try {
      const data = page === 1 ? first : await fetchPage(page);
      const items = toArray(data.body.items);

      if (items.length === 0) {
        throw new Error(`${page}페이지에 데이터가 없습니다`);
      }

      await writeFile(join(OUT_DIR, filename), JSON.stringify(items, null, 2), 'utf-8');

      if (page % 50 === 0 || page === totalPages) {
        console.log(`${page}/${totalPages}`);
      }
    } catch (err) {
      console.error(`${page}페이지 실패:`, err);
      console.error('다시 실행하면 이 페이지부터 이어받습니다.');
      process.exit(1);
    }

    await sleep(200);
  }

  // ── 검수: 페이지 누락과 건수 불일치를 여기서 잡는다 ──
  // 부분 수집을 모르고 넘어가면 그 품목들만 성분 없이 남는다.
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')).sort();

  const missing: string[] = [];
  for (let page = 1; page <= totalPages; page++) {
    const filename = `page-${String(page).padStart(4, '0')}.json`;
    if (!files.includes(filename)) missing.push(filename);
  }

  let collected = 0;
  for (const file of files) {
    const items = JSON.parse(await readFile(join(OUT_DIR, file), 'utf-8')) as unknown[];
    collected += items.length;
  }

  console.log(`\n파일 ${files.length}개 / 수집 ${collected}건 / 전체 ${totalCount}건`);

  if (missing.length > 0) {
    console.error(`❌ 누락 페이지 ${missing.length}개: ${missing.slice(0, 10).join(', ')}`);
    process.exit(1);
  }
  if (collected !== totalCount) {
    console.error(`❌ 건수 불일치 (${collected} ≠ ${totalCount}). 부분 수집 상태입니다.`);
    process.exit(1);
  }

  console.log(`✅ 완료. ${OUT_DIR}`);
}

main();

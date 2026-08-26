/**
 * DUR품목정보 수집 → 로컬 JSON 저장
 *
 * 실행: npm run fetch:dur-items
 *
 * 23,486건 / 235페이지. 앞선 수집들보다 훨씬 크다.
 *
 * 이 API 는 DUR 타입마다 한 행씩 나오므로 ITEM_SEQ 가 중복된다.
 * (같은 약이 임부금기·첨가제주의에 각각 걸리면 2행)
 * 유니크 품목 수는 적재 단계에서 센다.
 *
 * ★ DUR성분정보와 응답 구조가 다르다
 *   성분정보: body.items[].item   ← 한 겹 더
 *   품목정보: body.items[]        ← 바로
 */

import { config } from 'dotenv';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
config({ path: '.env.local' });

const API_KEY = process.env.MFDS_API_KEY;

// 성분정보는 서비스03 + 오퍼레이션02 였는데 여기는 둘 다 03 이다.
// 규칙이 없으므로 반드시 data.go.kr 문서에서 확인할 것.
const BASE_URL = 'https://apis.data.go.kr/1471000/DURPrdlstInfoService03';
const OPERATION = 'getDurPrdlstInfoList03';

const OUT_DIR = join(process.cwd(), 'supabase/data/dur-items');
const ROWS_PER_PAGE = 100;
const EXPECT_COUNT = 23486; // 2026.08 확인

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

/**
 * items 가 객체 하나로 오는 케이스 방어.
 * 원본이 XML 이라 결과가 1건이면 배열이 아닌 객체로 변환되는 경우가 있다.
 * 마지막 페이지에서만 터지므로 재현이 어렵다.
 */
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

  // 개발계정 일일 한도가 1만건이다. 235페이지 × 100건 = 23,500건이라
  // 하루에 다 못 받을 수 있다. 중단되면 다음 날 다시 실행하면 이어받는다.
  console.log('일일 트래픽 한도로 중단될 수 있습니다. 다시 실행하면 이어받습니다.\n');

  for (let page = 1; page <= totalPages; page++) {
    const filename = `page-${String(page).padStart(3, '0')}.json`;
    if (existing.has(filename)) continue;

    try {
      const data = page === 1 ? first : await fetchPage(page);
      const items = toArray(data.body.items);

      if (items.length === 0) {
        throw new Error(`${page}페이지에 데이터가 없습니다`);
      }

      await writeFile(join(OUT_DIR, filename), JSON.stringify(items, null, 2), 'utf-8');

      // 235페이지라 매 페이지 찍으면 콘솔이 넘친다
      if (page % 10 === 0 || page === totalPages) {
        console.log(`${page}/${totalPages}`);
      }
    } catch (err) {
      console.error(`${page}페이지 실패:`, err);
      console.error('다시 실행하면 이 페이지부터 이어받습니다.');
      process.exit(1);
    }

    await sleep(200);
  }

  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json'));
  console.log(`\n완료. ${OUT_DIR} 에 ${files.length}개 파일`);
}

main();

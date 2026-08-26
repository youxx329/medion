/**
 * e약은요(의약품개요정보) 전체 수집 → 로컬 JSON 저장
 *
 * 실행: npm run fetch:meds
 *
 * DB에 바로 넣지 않고 파일로 떨구는 이유:
 * 파싱이나 컬럼 매핑을 고칠 때마다 4,765건을 다시 긁으면 시간 낭비다.
 * 수집은 한 번, 적재는 몇 번이든.
 *
 * 이미 받은 페이지는 건너뛰므로 중단 후 다시 실행하면 이어받는다.
 */

import { config } from 'dotenv';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
config({ path: '.env.local' });

const API_KEY = process.env.MFDS_API_KEY;
const BASE_URL = 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList';
const OUT_DIR = join(process.cwd(), 'supabase/data/medications');
const ROWS_PER_PAGE = 100;

if (!API_KEY) {
  console.error('MFDS_API_KEY 가 .env.local 에 없습니다.');
  process.exit(1);
}

/** e약은요 응답 1건 (원본 필드명 그대로) */
type RawMedication = {
  itemSeq: string;
  itemName: string;
  entpName: string | null;
  efcyQesitm: string | null;
  useMethodQesitm: string | null;
  atpnWarnQesitm: string | null;
  atpnQesitm: string | null;
  intrcQesitm: string | null;
  seQesitm: string | null;
  depositMethodQesitm: string | null;
  itemImage: string | null;
};

type ApiResponse = {
  header: { resultCode: string; resultMsg: string };
  body: {
    pageNo: number;
    totalCount: number;
    numOfRows: number;
    items: RawMedication[];
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(pageNo: number): Promise<ApiResponse> {
  // ServiceKey 는 대문자 S. 소문자면 인증 실패한다.
  const params = new URLSearchParams({
    ServiceKey: API_KEY!,
    pageNo: String(pageNo),
    numOfRows: String(ROWS_PER_PAGE),
    type: 'json',
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  const text = await res.text();

  // 인증 실패나 서버 오류 시 JSON 이 아니라 XML 이 온다.
  // 그대로 JSON.parse 하면 알아보기 힘든 에러가 나므로 먼저 확인한다.
  if (text.trimStart().startsWith('<')) {
    throw new Error(`XML 응답 (인증키 확인 필요)\n${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text) as ApiResponse;

  if (json.header?.resultCode !== '00') {
    throw new Error(`API 오류: ${json.header?.resultMsg}`);
  }

  return json;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // 이미 받은 페이지 목록 (중단 후 재개용)
  const existing = new Set((await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')));

  // 첫 페이지로 전체 건수 확인
  const first = await fetchPage(1);
  const totalCount = first.body.totalCount;
  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE);

  console.log(`전체 ${totalCount}건 / ${totalPages}페이지`);
  if (existing.size > 0) {
    console.log(`이미 받은 페이지 ${existing.size}개는 건너뜁니다.`);
  }

  for (let page = 1; page <= totalPages; page++) {
    const filename = `page-${String(page).padStart(3, '0')}.json`;

    if (existing.has(filename)) continue;

    try {
      // 1페이지는 위에서 이미 받았으므로 재사용
      const data = page === 1 ? first : await fetchPage(page);
      const items = data.body.items;
      if (!items || items.length === 0) {
        throw new Error(`${page}페이지에 데이터가 없습니다`);
      }

      await writeFile(join(OUT_DIR, filename), JSON.stringify(items, null, 2), 'utf-8');

      console.log(`${page}/${totalPages}  ${items.length}건`);
    } catch (err) {
      // 여기서 멈춰도 받은 페이지는 남아 있으므로 다시 실행하면 이어받는다
      console.error(`${page}페이지 실패:`, err);
      console.error('다시 실행하면 이 페이지부터 이어받습니다.');
      process.exit(1);
    }

    await sleep(200); // 연속 호출 간격
  }

  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json'));
  console.log(`\n완료. ${OUT_DIR} 에 ${files.length}개 파일`);
}

main();

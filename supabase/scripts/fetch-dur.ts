/**
 * DUR성분정보 4종 수집 → 로컬 JSON 저장
 *
 * 실행: npm run fetch:dur
 *
 * 병용금기(1,836) / 임부금기(1,459) / 연령금기(233) / 노인주의(112)
 * 총 3,640건. fetch:meds 와 같은 이유로 수집과 적재를 분리한다.
 *
 * 타입별로 폴더를 나누는 이유:
 * condition_type 을 응답에서 얻을 수 없다. 어느 API 를 호출했는지가 유일한 근거라
 * 그 정보를 폴더 구조로 남긴다. 파일 하나에 섞으면 출처를 잃는다.
 *
 * 응답은 가공하지 않고 그대로 저장한다(items[].item 중첩 포함).
 * 파싱 규칙을 고칠 때 원본이 남아있어야 다시 받지 않는다.
 */

import { config } from 'dotenv';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
config({ path: '.env.local' });

const API_KEY = process.env.MFDS_API_KEY;

// ⚠️ 승인받은 서비스 URL 로 확인할 것. data.go.kr 마이페이지 > 활용신청 현황에서
//    엔드포인트를 그대로 복사하는 게 안전하다. 버전 접미사(03 등)가 붙는 경우가 있다.
const BASE_URL = 'https://apis.data.go.kr/1471000/DURIrdntInfoService03';

const OUT_ROOT = join(process.cwd(), 'supabase/data/dur');
const ROWS_PER_PAGE = 100;

/**
 * key 가 그대로 폴더명이 되고, 조건금기는 dur_conditions.condition_type 값이 된다.
 * 로더가 이 문자열에 의존하므로 바꾸면 load-dur.ts 도 같이 고쳐야 한다.
 */
const TARGETS = [
  { key: 'interaction', op: 'getUsjntTabooInfoList02', label: '병용금기', expect: 1836 },
  { key: 'pregnancy', op: 'getPwnmTabooInfoList02', label: '임부금기', expect: 1459 },
  { key: 'age', op: 'getSpcifyAgrdeTabooInfoList02', label: '특정연령대금기', expect: 233 },
  { key: 'elderly', op: 'getOdsnAtentInfoList02', label: '노인주의', expect: 112 },
] as const;

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
    // DUR 3종은 items[].item 으로 한 겹 더 들어간다.
    // 결과가 1건일 때 배열이 아니라 객체로 오는 경우가 있어 그대로 받는다.
    items: unknown;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(op: string, pageNo: number): Promise<ApiResponse> {
  const params = new URLSearchParams({
    ServiceKey: API_KEY!,
    pageNo: String(pageNo),
    numOfRows: String(ROWS_PER_PAGE),
    type: 'json',
  });

  const res = await fetch(`${BASE_URL}/${op}?${params}`);
  const text = await res.text();

  // 인증 실패·트래픽 초과 시 JSON 이 아니라 XML 이 온다.
  if (text.trimStart().startsWith('<')) {
    throw new Error(`XML 응답 (인증키/트래픽 확인)\n${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text) as ApiResponse;

  if (json.header?.resultCode !== '00') {
    throw new Error(`API 오류: ${json.header?.resultMsg}`);
  }

  return json;
}

/** items 가 객체 하나로 오는 케이스 방어 */
function toArray(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') return [items];
  return [];
}

async function fetchTarget(target: (typeof TARGETS)[number]) {
  const outDir = join(OUT_ROOT, target.key);
  await mkdir(outDir, { recursive: true });

  const existing = new Set((await readdir(outDir)).filter((f) => f.endsWith('.json')));

  const first = await fetchPage(target.op, 1);
  const totalCount = first.body.totalCount;
  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE);

  // 문서에 기록된 건수와 다르면 API 쪽이 갱신된 것이다.
  // 멈추지는 않되 눈에 띄게 남긴다. 검증 쿼리 기대값이 달라진다.
  const mismatch = totalCount !== target.expect ? `  ⚠️ 문서 기록 ${target.expect}건과 다름` : '';
  console.log(`\n[${target.label}] ${totalCount}건 / ${totalPages}페이지${mismatch}`);

  for (let page = 1; page <= totalPages; page++) {
    const filename = `page-${String(page).padStart(3, '0')}.json`;
    if (existing.has(filename)) continue;

    try {
      const data = page === 1 ? first : await fetchPage(target.op, page);
      const items = toArray(data.body.items);

      if (items.length === 0) {
        throw new Error(`${page}페이지에 데이터가 없습니다`);
      }

      await writeFile(join(outDir, filename), JSON.stringify(items, null, 2), 'utf-8');
      console.log(`  ${page}/${totalPages}  ${items.length}건`);
    } catch (err) {
      console.error(`  ${target.label} ${page}페이지 실패:`, err);
      console.error('  다시 실행하면 이 페이지부터 이어받습니다.');
      process.exit(1);
    }

    await sleep(200);
  }
}

async function main() {
  for (const target of TARGETS) {
    await fetchTarget(target);
  }

  console.log(`\n완료. ${OUT_ROOT}`);
  console.log('첫 파일을 한 번 열어보고 MIXTURE_ 접두사 필드명을 확인하세요.');
  console.log('(load-dur.ts 의 RawInteraction 타입이 그 이름에 의존합니다)');
}

main();

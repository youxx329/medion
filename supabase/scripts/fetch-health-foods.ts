/**
 * 건강기능식품 검색어별 수집 → 로컬 JSON 저장
 *
 * 실행: npm run fetch:hf
 *
 * 45,935건 전체를 받지 않는다. 판매 상품으로만 쓰이고 DUR 검사 대상이
 * 아니므로 필요한 것만 검색해서 가져온다.
 *
 * getHtfsItem01 은 이름이 "상세조회"지만 목록처럼 페이지네이션이 되고
 * 필드를 전부 준다. getHtfsList01 은 4개 필드만 주므로 쓰지 않는다.
 *
 * Prduct 파라미터로 제품명 부분 검색이 된다.
 * 기능성(MAIN_FNCTN)은 검색되지 않으므로 성분명으로 찾아야 한다.
 */

import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
config({ path: '.env.local' });

const API_KEY = process.env.MFDS_API_KEY;
const BASE_URL = 'https://apis.data.go.kr/1471000/HtfsInfoService03';
const OPERATION = 'getHtfsItem01';
const OUT_DIR = join(process.cwd(), 'supabase/data/health-foods');
const ROWS = 30; // 검색어당 최대 건수

if (!API_KEY) {
  console.error('MFDS_API_KEY 가 .env.local 에 없습니다.');
  process.exit(1);
}

/**
 * 검색어. 카테고리 중분류에 대응한다.
 */
const KEYWORDS = ['뉴눈엔', '벨더웰', '프로팜', '아스타잔틴', '눈건강', '루테인지아잔틴'];

type RawItem = {
  STTEMNT_NO: string;
  PRDUCT: string;
  ENTRPS: string | null;
  REGIST_DT: string | null;
  DISTB_PD: string | null;
  SUNGSANG: string | null;
  SRV_USE: string | null;
  PRSRV_PD: string | null;
  INTAKE_HINT1: string | null;
  MAIN_FNCTN: string | null;
  BASE_STANDARD: string | null;
};

type ApiResponse = {
  header: { resultCode: string; resultMsg: string };
  body: {
    pageNo: number;
    totalCount: number;
    numOfRows: number;
    // items[].item 중첩
    items: unknown;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** items 가 객체 하나로 오는 케이스 방어 */
function toArray(items: unknown): unknown[] {
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object') return [items];
  return [];
}

async function search(keyword: string): Promise<{ total: number; items: RawItem[] }> {
  const params = new URLSearchParams({
    ServiceKey: API_KEY!,
    pageNo: '1',
    numOfRows: String(ROWS),
    type: 'json',
    Prduct: keyword,
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

  const items = toArray(json.body.items).map((r) => {
    const obj = r as Record<string, unknown>;
    return (obj?.item ?? obj) as RawItem;
  });

  return { total: json.body.totalCount, items };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const summary: { keyword: string; total: number; saved: number }[] = [];

  for (const keyword of KEYWORDS) {
    try {
      const { total, items } = await search(keyword);

      await writeFile(join(OUT_DIR, `${keyword}.json`), JSON.stringify(items, null, 2), 'utf-8');

      summary.push({ keyword, total, saved: items.length });

      // 0건이면 그 중분류에 상품을 붙일 수 없다는 뜻이다
      const flag = total === 0 ? '  ❌ 검색 결과 없음' : '';
      console.log(
        `${keyword.padEnd(10)} 전체 ${String(total).padStart(5)}건 → ${items.length}건 저장${flag}`
      );
    } catch (err) {
      console.error(`${keyword} 실패:`, err);
    }

    await sleep(200);
  }

  console.log(`\n완료. ${OUT_DIR}`);

  const empty = summary.filter((s) => s.total === 0);
  if (empty.length > 0) {
    console.log(`\n❌ 결과 없는 검색어: ${empty.map((s) => s.keyword).join(', ')}`);
    console.log('   해당 중분류는 상품을 채울 수 없다. 카테고리 재검토 필요.');
  }

  console.log('\n다음: 각 JSON 을 열어 판매할 제품을 고르고 selected.json 을 만든다.');
  console.log('원료 등록 건이 섞여 있으므로(SRV_USE 가 "건강기능식품 원료로 사용")');
  console.log('완제품인지 눈으로 확인할 것.');
}

main();

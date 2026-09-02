import { config } from 'dotenv';
config({ path: '.env.local' });

const KEY = process.env.MFDS_API_KEY!;
const BASE = 'https://apis.data.go.kr/1471000/HtfsInfoService03';

async function probe(keyword: string) {
  const params = new URLSearchParams({
    ServiceKey: KEY,
    pageNo: '1',
    numOfRows: '5',
    type: 'json',
    Prduct: keyword,
  });

  const res = await fetch(`${BASE}/getHtfsItem01?${params}`);
  const text = await res.text();

  console.log(`\n=== ${keyword}`);
  console.log(text.slice(0, 2000));
}

async function main() {
  await probe('루나타임');
}

main();

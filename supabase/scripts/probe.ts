import { config } from 'dotenv';
config({ path: '.env.local' });

const KEY = process.env.MFDS_API_KEY!;
const BASE = 'https://apis.data.go.kr/1471000/DURIrdntInfoService03';

const CANDIDATES = ['getUsjntTabooInfoList02'];

async function main() {
  for (const op of CANDIDATES) {
    const params = new URLSearchParams({
      ServiceKey: KEY,
      pageNo: '1',
      numOfRows: '2',
      type: 'json',
    });

    const res = await fetch(`${BASE}/${op}?${params}`);
    const text = await res.text();

    console.log(`\n=== ${op}  (status ${res.status})`);
    console.log(text.slice(0, 1500));
  }
}

main();

import { config } from 'dotenv';
config({ path: '.env.local' });

const KEY = process.env.MFDS_API_KEY!;
const URL = 'https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getDurPrdlstInfoList03';

async function main() {
  const params = new URLSearchParams({
    ServiceKey: KEY,
    pageNo: '1',
    numOfRows: '3',
    type: 'json',
  });

  const res = await fetch(`${URL}?${params}`);
  const text = await res.text();

  console.log('--- status:', res.status);
  console.log(text.slice(0, 3000));
}

main();

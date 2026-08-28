import { readFileSync } from 'node:fs';

type Row = {
  item_seq: string;
  name: string;
  etc_otc_code: string | null;
  material_name: string;
};

// 중분류별 대표 성분. 이 성분이 들어간 일반약이 몇 건인지 센다.
const GROUPS: Record<string, string[]> = {
  종합감기: ['아세트아미노펜', '클로르페니라민', '슈도에페드린'],
  '목·인후': ['세틸피리디늄', '벤지다민', '트로키'],
  '코·비염': ['슈도에페드린', '옥시메타졸린', '자일로메타졸린'],
  알레르기: ['세티리진', '로라타딘', '펙소페나딘'],

  해열진통: ['아세트아미노펜', '나프록센'],
  소염진통: ['이부프로펜', '덱시부프로펜', '아세클로페낙'],
  근이완: ['클로르족사존', '에페리손', '산화마그네슘'],
  파스: ['케토프로펜', '플루르비프로펜', '살리실산메틸'],

  '소화·속쓰림': ['판크레아틴', '시메티딘', '파모티딘', '수산화알루미늄'],
  '변비·설사': ['비사코딜', '차전자피', '로페라미드'],
  치질: ['리도카인', '히드로코르티손', '폴리크레줄렌'],

  '연고·외용제': ['무피로신', '테르비나핀', '덱스판테놀', '히드로코르티손'],
  '밴드·소독': ['포비돈', '과산화수소', '클로르헥시딘'],
  피부미용: ['알부틴', '아젤라산', '살리실산'],

  '인공눈물·눈건강': ['히알루론산나트륨', '카르복시메틸셀룰로오스'],
  구강청결: ['클로르헥시딘', '세틸피리디늄'],
  잇몸: ['카바조크롬', '토코페롤', '옥수수불검화'],

  '엽산·임산부': ['엽산'],
  철분: ['철', '푸마르산제일철', '황산철'],
  다이어트: ['오르리스타트', '가르시니아'],

  어린이감기: ['아세트아미노펜', '이부프로펜'],

  '구충·멀미': ['알벤다졸', '플루벤다졸', '디멘히드리네이트', '스코폴라민'],
};

const rows = JSON.parse(readFileSync('supabase/data/material-names.json', 'utf-8')) as Row[];

for (const [label, keywords] of Object.entries(GROUPS)) {
  const hit = new Set<string>();
  const perKeyword: string[] = [];

  for (const kw of keywords) {
    const found = rows.filter((r) => r.material_name.includes(kw));
    found.forEach((r) => hit.add(r.item_seq));
    perKeyword.push(`${kw} ${found.length}`);
  }

  const flag = hit.size === 0 ? '  ❌' : hit.size < 3 ? '  ⚠️' : '';
  console.log(`${label.padEnd(16)} ${String(hit.size).padStart(4)}건${flag}`);
  console.log(`    ${perKeyword.join(' / ')}`);
}

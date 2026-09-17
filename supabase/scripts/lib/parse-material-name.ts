/**
 * dur-items MATERIAL_NAME 파서
 *
 * 형식: 성분명,비고,함량,단위,규격,  (복합제는 ",/" 로 구분)
 * 예:   로수바스타틴칼슘, - 내수용,5.2,밀리그램,EP,/에제티미브, - 내수용,10.0,밀리그램,USP,
 *
 * 함량에 천단위 쉼표가 들어가는 경우(1,330)가 있어 필드 개수가 고정이 아니다.
 * → 앞에서 2개(성분명·비고), 뒤에서 2개(단위·규격)를 고정하고 남는 가운데를 함량으로 본다.
 *
 * 형식이 예상과 다르면 추측하지 않고 던진다.
 * 잘못 읽은 함량·성분명이 조용히 들어가면 DUR 검사가 틀린 근거로 판정한다.
 */

export type ParsedIngredient = {
  rawName: string;
  note: string;
  amount: number | null;
  unit: string;
  spec: string;
};

export class MaterialParseError extends Error {
  constructor(reason: string, chunk: string, raw: string) {
    super(`${reason}\n  chunk: ${chunk}\n  raw:   ${raw}`);
    this.name = 'MaterialParseError';
  }
}

// 비고는 빈 값이거나 " - 내수용" 형태만 허용.
// 성분명에 쉼표가 섞이면 뒷부분이 비고 자리로 밀려와 여기서 걸린다.
const NOTE_PATTERN = /^( - .+)?$/;

export function parseMaterialName(raw: string): ParsedIngredient[] {
  const trimmed = raw.trim();
  if (trimmed === '') throw new MaterialParseError('MATERIAL_NAME 이 비어 있음', '', raw);

  const body = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
  return body.split(',/').map((chunk) => parseChunk(chunk, raw));
}

function parseChunk(chunk: string, raw: string): ParsedIngredient {
  const fields = chunk.split(',');
  if (fields.length < 5)
    throw new MaterialParseError(`필드 수 부족 (${fields.length}개)`, chunk, raw);

  const name = fields[0].trim();
  const note = fields[1];
  const unit = fields[fields.length - 2].trim();
  const spec = fields[fields.length - 1].trim();
  const amountParts = fields.slice(2, -2);

  if (name === '') throw new MaterialParseError('성분명이 비어 있음', chunk, raw);
  if (!NOTE_PATTERN.test(note))
    throw new MaterialParseError(`비고 형식 이상: "${note}"`, chunk, raw);
  if (unit === '') throw new MaterialParseError('단위가 비어 있음', chunk, raw);

  return {
    rawName: name,
    note: note.trim(),
    amount: parseAmount(amountParts, chunk, raw),
    unit,
    spec,
  };
}

function parseAmount(parts: string[], chunk: string, raw: string): number | null {
  // 함량 빈 값: "소청룡탕 연조엑스,,,밀리그램,별규,"
  if (parts.length === 1 && parts[0].trim() === '') return null;

  if (parts.length === 1) {
    const v = parts[0].trim();
    if (!/^\d+(\.\d+)?$/.test(v))
      throw new MaterialParseError(`함량 형식 이상: "${v}"`, chunk, raw);
    return Number(v);
  }

  // 천단위 쉼표: 첫 덩어리 1~3자리, 이후는 정확히 3자리(마지막은 소수부 허용)
  const [head, ...rest] = parts.map((p) => p.trim());
  const last = rest[rest.length - 1];
  const middles = rest.slice(0, -1);
  const valid =
    /^\d{1,3}$/.test(head) &&
    middles.every((m) => /^\d{3}$/.test(m)) &&
    /^\d{3}(\.\d+)?$/.test(last);

  if (!valid)
    throw new MaterialParseError(`함량 천단위 형식 이상: "${parts.join(',')}"`, chunk, raw);
  return Number([head, ...rest].join(''));
}

/**
 * 내수용/수출용 중복 제거. 성분명 기준.
 * 같은 성분인데 함량·단위가 다르면 판단하지 않고 던진다.
 */
export function dedupeIngredients(items: ParsedIngredient[], raw: string): ParsedIngredient[] {
  const byName = new Map<string, ParsedIngredient>();

  for (const item of items) {
    const prev = byName.get(item.rawName);
    if (prev === undefined) {
      byName.set(item.rawName, item);
      continue;
    }
    if (prev.amount !== item.amount || prev.unit !== item.unit) {
      throw new MaterialParseError(
        `같은 성분 함량 불일치: ${item.rawName} (${prev.amount}${prev.unit} vs ${item.amount}${item.unit})`,
        '',
        raw
      );
    }
  }
  return [...byName.values()];
}

/**
 * ingredients → 성분명 조회용 인덱스
 * ori_names: "[M083733]이트라코나졸제피과립/[M083734]이트라코나졸/..."
 *
 * 성분명 안에 "/" 가 있을 수 있으므로 "[" 앞의 "/" 에서만 자른다.
 * 한 이름이 여러 ingredient 에 걸리면 고르지 않고 Set 그대로 돌려준다.
 */
export type IngredientRow = {
  id: string;
  code: string;
  name_ko: string;
  ori_names: string | null;
};

export function buildNameIndex(rows: IngredientRow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  const add = (name: string, id: string) => {
    const key = name.trim();
    if (key === '') return;
    const ids = index.get(key);
    if (ids === undefined) index.set(key, new Set([id]));
    else ids.add(id);
  };

  for (const row of rows) {
    add(row.name_ko, row.id);
    if (row.ori_names === null) continue;

    for (const entry of row.ori_names.split(/\/(?=\[)/)) {
      const m = entry.match(/^\[([^\]]+)\](.+)$/);
      if (m === null) {
        throw new Error(`ori_names 형식 이상 (ingredient ${row.code}): "${entry}"`);
      }
      add(m[2], row.id);
    }
  }
  return index;
}

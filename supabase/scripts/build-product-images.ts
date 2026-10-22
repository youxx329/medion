/**
 * 상품 이미지 만들기
 * image-src/*.png (원본, 건드리지 않음)
 *   → 배경 제거 (이미 투명하면 건너뜀)
 *   → 오른쪽 아래 구석 지우기 (제미나이 워터마크)
 *   → 투명 여백 자르고 정사각형 가운데 정렬
 *   → public/images/products/{code}.webp
 */
import { removeBackground } from '@imgly/background-removal-node';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const SRC = join(process.cwd(), 'image-src');
const OUT = join(process.cwd(), 'public/images/products');
const CANVAS = 800; // 결과 정사각형 크기
const FILL = 0.95; // 상품이 차지할 최대 비율
const CORNER = 0.12; // 오른쪽 아래 지울 범위

/** 네 귀퉁이가 전부 투명하면 이미 배경이 날아간 이미지 */
async function isTransparent(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const alpha = (x: number, y: number) => data[(y * w + x) * channels + 3];
  return [alpha(0, 0), alpha(w - 1, 0), alpha(0, h - 1), alpha(w - 1, h - 1)].every((a) => a < 10);
}

async function cutout(buf: Buffer) {
  const blob = await removeBackground(new Blob([new Uint8Array(buf)], { type: 'image/png' }));
  return Buffer.from(await blob.arrayBuffer());
}

/** 오른쪽 아래 구석을 투명하게. 지운 게 있었으면 true */
async function eraseCorner(buf: Buffer) {
  const { width, height } = await sharp(buf).metadata();
  if (!width || !height) throw new Error('크기를 읽을 수 없음');
  const cw = Math.round(width * CORNER);
  const ch = Math.round(height * CORNER);

  const corner = await sharp(buf)
    .ensureAlpha()
    .extract({ left: width - cw, top: height - ch, width: cw, height: ch })
    .raw()
    .toBuffer();
  const had = corner.some((v, i) => i % 4 === 3 && v > 10);

  const eraser = await sharp({
    create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const cleaned = await sharp(buf)
    .ensureAlpha()
    .composite([{ input: eraser, left: width - cw, top: height - ch, blend: 'dest-out' }])
    .png()
    .toBuffer();
  return { cleaned, had };
}

async function center(buf: Buffer) {
  const trimmed = await sharp(buf).trim().toBuffer();
  const box = Math.round(CANVAS * FILL);
  const resized = await sharp(trimmed).resize(box, box, { fit: 'inside' }).toBuffer();
  return sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .webp({ quality: 90 });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(SRC)).filter((f) => /\.png$/i.test(f));
  const cut: string[] = [];
  const erased: string[] = [];
  const failed: string[] = [];

  for (const [i, file] of files.entries()) {
    const code = parse(file).name;
    try {
      let buf = await readFile(join(SRC, file));
      if (!(await isTransparent(buf))) {
        buf = await cutout(buf);
        cut.push(code);
      }
      const { cleaned, had } = await eraseCorner(buf);
      if (had) erased.push(code);
      await (await center(cleaned)).toFile(join(OUT, `${code}.webp`));
      console.log(`[${i + 1}/${files.length}] ${code}`);
    } catch (e) {
      failed.push(`${code}: ${(e as Error).message}`);
    }
  }

  console.log(`\n완료 ${files.length - failed.length}/${files.length} → ${OUT}`);
  console.log(`배경 제거한 것 ${cut.length}개`);
  console.log(`구석 지운 것 ${erased.length}개: ${erased.join(', ')}`);
  if (failed.length > 0) {
    console.log(`\n실패 ${failed.length}개`);
    failed.forEach((f) => console.log(`   ${f}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

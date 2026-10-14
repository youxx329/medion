/**
 * 상품 이미지 일괄 정리
 * 원본(image-src) → 배경 제거 → 여백 자르기 → 3:4 캔버스 중앙 배치 → WebP
 * 실행: npx tsx supabase/scripts/process-images.ts
 */
import { removeBackground } from '@imgly/background-removal-node';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const SRC = 'image-src';
const OUT = 'public/images/products';
const CANVAS_W = 900;
const CANVAS_H = 1200; // 3:4
const MAX_W = 0.7; // 상품이 캔버스에서 차지할 최대 비율
const MAX_H = 0.75;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(SRC)).filter((f) => MIME[parse(f).ext.toLowerCase()]).sort();
  console.log(`${files.length}장 처리 시작`);

  const failed: string[] = [];

  for (const [i, file] of files.entries()) {
    const { name, ext } = parse(file);
    try {
      // 1. 배경 제거
      const input = await readFile(join(SRC, file));
      const blob = await removeBackground(new Blob([input], { type: MIME[ext.toLowerCase()] }));
      const cut = Buffer.from(await blob.arrayBuffer());

      // 2. 투명 여백 잘라내기 → 3. 캔버스 안에 맞게 크기 통일
      const product = await sharp(cut)
        .trim()
        .resize({
          width: Math.round(CANVAS_W * MAX_W),
          height: Math.round(CANVAS_H * MAX_H),
          fit: 'inside',
        })
        .toBuffer();

      // 4. 투명 3:4 캔버스 정중앙에 배치 → 5. WebP 저장
      await sharp({
        create: {
          width: CANVAS_W,
          height: CANVAS_H,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: product, gravity: 'center' }])
        .webp({ quality: 85 })
        .toFile(join(OUT, `${name}.webp`));

      console.log(`  [${i + 1}/${files.length}] ${name}`);
    } catch (e) {
      failed.push(name);
      console.log(`  ⚠ ${name}: ${(e as Error).message}`);
    }
  }

  console.log(`\n완료 (실패 ${failed.length}건)`);
  if (failed.length) console.log(failed.join('\n'));
}

main();

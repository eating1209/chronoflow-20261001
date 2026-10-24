#!/usr/bin/env node
/**
 * 把手机原始截图（1216×2688 之类）统一成商店可用尺寸。
 *
 * 只做两件事：等比缩到目标宽度（不裁切、不加黑边，避免切掉状态栏/底部导航）、
 * 按目标 JPEG 质量重编码。纯 JS，靠仓库里已有的 jpeg-js，不需要 sharp / ImageMagick。
 *
 * 用法：
 *   node scripts/store_screenshots.js <输出目录> <宽> <文件名>=<源图> ...
 *   node scripts/store_screenshots.js docs/03-上架/截图-1.1.0 1080 01-日历=a.jpg 02-识别=b.jpg
 */
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');

const [, , outDir, widthArg, ...pairs] = process.argv;
if (!outDir || !widthArg || pairs.length === 0) {
  console.error('用法：node scripts/store_screenshots.js <输出目录> <宽> <文件名>=<源图> ...');
  process.exit(2);
}
const targetW = Number(widthArg);
fs.mkdirSync(outDir, { recursive: true });

function bilinear(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i01 + c] * fx;
        const bottom = src[i10 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

let failures = 0;
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  const name = pair.slice(0, eq);
  const srcPath = pair.slice(eq + 1);
  if (!fs.existsSync(srcPath)) {
    console.error(`✗ 源图不存在：${srcPath}`);
    failures++;
    continue;
  }
  const raw = jpeg.decode(fs.readFileSync(srcPath), { useTArray: true, formatAsRGBA: true });
  const targetH = Math.round((raw.height * targetW) / raw.width);
  const data = bilinear(raw.data, raw.width, raw.height, targetW, targetH);
  const encoded = jpeg.encode({ data, width: targetW, height: targetH }, 90);
  const outPath = path.join(outDir, `${name}.jpg`);
  fs.writeFileSync(outPath, encoded.data);
  const kb = Math.round(encoded.data.length / 1024);
  console.log(`✓ ${outPath}  ${raw.width}×${raw.height} → ${targetW}×${targetH}  ${kb}KB`);
}
process.exit(failures ? 1 : 0);

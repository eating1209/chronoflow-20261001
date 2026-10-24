#!/usr/bin/env node
/**
 * 把竖屏截图装进商店要求的固定画布（如 1080×1920）。
 *
 * 为什么不是裁切：手机截图是 9:19.9，1080×1920 是 9:16，直接裁要切掉 19% 的高度，
 * 状态栏或底部导航栏必然被切掉一块。为什么不拉伸：字会变胖，审核一眼看出失真。
 * 所以这里按高度铺满，左右补上与截图同色的底——内容完整、不变形。
 *
 * 用法：node scripts/store_screenshots_fit.js <输出目录> <宽x高> <名字=源图> ...
 */
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');

const [, , outDir, sizeArg, ...pairs] = process.argv;
const m = /^(\d+)x(\d+)$/.exec(sizeArg || '');
if (!outDir || !m || pairs.length === 0) {
  console.error('用法：node scripts/store_screenshots_fit.js <输出目录> <宽x高> <名字=源图> ...');
  process.exit(2);
}
const DW = Number(m[1]);
const DH = Number(m[2]);
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
  // 以高度为基准等比缩放；宽度必须 ≤ 画布宽，否则改以宽度为基准（超长图会上下留白）
  let tw = Math.round((raw.width * DH) / raw.height);
  let th = DH;
  if (tw > DW) {
    tw = DW;
    th = Math.round((raw.height * DW) / raw.width);
  }
  const scaled = bilinear(raw.data, raw.width, raw.height, tw, th);

  // 补底色：取源图四角的中位数，白底截图就是纯白，深色模式截图也不会突兀
  const corners = [0, (raw.width - 1) * 4, (raw.height - 1) * raw.width * 4, ((raw.height - 1) * raw.width + raw.width - 1) * 4];
  const bg = [0, 1, 2].map((c) => {
    const vals = corners.map((i) => raw.data[i + c]).sort((a, b) => a - b);
    return vals[1];
  });

  const canvas = Buffer.alloc(DW * DH * 4);
  for (let i = 0; i < DW * DH; i++) {
    canvas[i * 4] = bg[0];
    canvas[i * 4 + 1] = bg[1];
    canvas[i * 4 + 2] = bg[2];
    canvas[i * 4 + 3] = 255;
  }
  const ox = Math.floor((DW - tw) / 2);
  const oy = Math.floor((DH - th) / 2);
  for (let y = 0; y < th; y++) {
    scaled.copy(canvas, ((oy + y) * DW + ox) * 4, y * tw * 4, (y + 1) * tw * 4);
  }

  const encoded = jpeg.encode({ data: canvas, width: DW, height: DH }, 90);
  const outPath = path.join(outDir, `${name}.jpg`);
  fs.writeFileSync(outPath, encoded.data);
  console.log(`✓ ${outPath}  ${raw.width}×${raw.height} → ${DW}×${DH}（内容 ${tw}×${th}，补底色 rgb(${bg.join(',')})）  ${Math.round(encoded.data.length / 1024)}KB`);
}
process.exit(failures ? 1 : 0);

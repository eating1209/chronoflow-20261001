/**
 * 繁体 → 简体（OpenCC 的 t2cn 预设，只带 T2S 词典，约 107KB）。
 *
 * <p>**为什么需要这一步**：云端模型虽然通常返回简体，但偶尔仍会输出繁体
 * （「開會」「臺灣」「明天下午三點」，尤其人名 / 地名）；之前的离线 Whisper
 * 则几乎总是繁体。本产品面向简体中文用户，繁体看起来像「识别错了」。
 *
 * <p>云端 `qwen3-asr-flash` 通常就是简体，转换对它基本无副作用；
 * 所以两条通道统一过这一层，界面拿到的永远是简体。
 */

import * as OpenCC from 'opencc-js/t2cn';

const converter = OpenCC.Converter({ from: 't', to: 'cn' });

export function toSimplified(text: string): string {
  if (!text) {
    return text;
  }
  try {
    return converter(text);
  } catch (cause) {
    // 转换失败不应该让整次识别失败：原文至少还能用
    console.log(`[asr] 繁转简失败：${String(cause)}`);
    return text;
  }
}

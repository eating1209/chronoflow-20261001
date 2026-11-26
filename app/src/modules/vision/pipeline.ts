import type { Endpoints } from '../../api/endpoints';
import { APP_TIMEZONE } from '../calendar/pure';
import { draftsFromItems, type RecognizedDraft } from './domain/vision';
import { ocrImageText } from './ocr/onDevice';

export type ImageRecognitionResult =
  | {
    status: 'ready';
    drafts: RecognizedDraft[];
    ocrText: string;
    ocrMs: number;
    parseMs: number;
  }
  | {
    status: 'no-text';
    ocrMs: number;
  }
  | {
    status: 'no-drafts';
    ocrText: string;
    ocrMs: number;
    parseMs: number;
  };

/**
 * 图片识别日程的共用链路：端侧 OCR → 服务端文字解析 → 草稿。
 *
 * <p>日历页选图与系统分享都走这里，保证两条入口的识别口径、耗时日志和空结果处理一致。
 * 原始图片始终只在手机本地由 OCR 读取，发给服务端的只有识别出来的文字。
 */
export async function recognizeScheduleImage(options: {
  uri: string;
  api: Endpoints;
  today: string;
  timezone?: string;
}): Promise<ImageRecognitionResult> {
  const started = Date.now();
  const ocrStart = Date.now();
  const ocrText = await ocrImageText(options.uri);
  const ocrMs = Date.now() - ocrStart;
  if (!ocrText.trim()) {
    return { status: 'no-text', ocrMs };
  }

  const parseStart = Date.now();
  const parsed = await options.api.parseScheduleText({
    text: ocrText,
    today: options.today,
    timezone: options.timezone ?? APP_TIMEZONE,
  });
  const parseMs = Date.now() - parseStart;
  const drafts = draftsFromItems(parsed.items);
  console.log(
    `[vision] 耗时：端侧 OCR ${ocrMs}ms（${ocrText.length} 字）→ 云端解析 ${parseMs}ms`
    + ` → 合计 ${Date.now() - started}ms，草稿 ${drafts.length} 条`,
  );
  if (drafts.length === 0) {
    return { status: 'no-drafts', ocrText, ocrMs, parseMs };
  }
  return { status: 'ready', drafts, ocrText, ocrMs, parseMs };
}

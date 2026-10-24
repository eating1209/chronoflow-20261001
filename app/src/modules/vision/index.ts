/**
 * vision 模块的公开出口。
 *
 * 其他模块（calendar / App）只能从这里拿东西，**不许**直接 import
 * `modules/vision/ocr/...` 或 `modules/vision/domain/...`——这条由
 * `npm run check:boundaries` 强制。
 *
 * 模块内部分三层：
 * - `ocr/`    端侧识别（PaddleOCR + ONNX Runtime），图片不出手机
 * - `domain/` 识别结果 → 日程草稿的纯函数（可在 node 里单测）
 * - `screens/` 识别确认页
 */
export {
  defaultTimeNote,
  draftsFromItems,
  draftDateKey,
  draftToEventDraft,
  normalizeTime,
  type RecognizedDraft,
} from './domain/vision';

export {
  DeviceRecognitionUnavailable,
  ocrImageText,
  registerOcrEngine,
  warmUpOcrEngine,
  type OcrEngine,
} from './ocr/onDevice';

export { registerBundledOcrEngine } from './ocr/register';

export { EventImportScreen, type DraftEdit } from './screens/EventImportScreen';

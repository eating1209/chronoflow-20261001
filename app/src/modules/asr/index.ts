/**
 * asr（语音输入）模块的公开出口。
 *
 * <p>其他模块只能从这里拿东西（`npm run check:boundaries` 强制）。内部分层：
 * - `domain/` 纯逻辑：繁转简、按住说话状态机、转写文字归一（可在 node 里单测）
 * - `engines/cloud.ts` 云端转写（百炼 `qwen3-asr-flash`）
 * - `recording/` 16 kHz PCM 录音适配层（原生模块由 config plugin 注入）
 * - `screens/` 「按住说话」页面
 *
 * <p>2026-11-01 已移除离线 Whisper：断网时语音不可用，界面会如实提示。
 */

export {
  channelLabel,
  describeFailure,
  type AsrAttemptFailure,
  type AsrChannel,
  type AsrResult,
} from './domain/asr';

export {
  HOLD_THRESHOLD_MS,
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  SLIDE_CANCEL_PX,
  formatDuration,
  outcomeOfRelease,
  phaseAfterMove,
  phaseAfterPressIn,
  type HoldPhase,
  type ReleaseOutcome,
} from './domain/holdToTalk';

export {
  MAX_TRANSCRIPT_CHARS,
  normalizeTranscript,
  transcriptProblem,
  transcriptProblemMessage,
  type TranscriptProblem,
} from './domain/transcript';

export { CLOUD_TIMEOUT_MS, VoiceTranscriptionError, transcribeRecording } from './service';

export { VoiceInputScreen } from './screens/VoiceInputScreen';

/**
 * 转写文字的归一与校验（纯逻辑）。
 *
 * <p>Whisper 与云端模型的输出习惯不同：Whisper 常带多余空格 / 换行、偶尔整段为空；
 * 云端可能返回很长的段落。这里统一成「能直接交给 `/ai/events/parse-text` 的一段文字」，
 * 并把「空」和「太长」这两种必须在发请求前挡掉的情况做成明确的判断。
 */

/**
 * 一段语音指令的字数上限。
 *
 * <p>30 秒的中文正常语速大约 100–150 字；1000 字是「识别明显跑偏 / 录到了整段会议」
 * 的信号，发上去只会浪费一次模型调用，也让用户等更久。留足余量，不误伤正常输入。
 */
export const MAX_TRANSCRIPT_CHARS = 1000;

/** 去掉首尾空白、合并多余空格/空行；中文之间不插空格。 */
export function normalizeTranscript(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export type TranscriptProblem = 'empty' | 'too-long';

/**
 * 能不能拿去解析。返回 null 表示可以用。
 *
 * <p>长度按**码点**算（`[...text].length`）：emoji 不会被当成两个字，
 * 与 `domain/profile.ts` 的字数口径保持一致。
 */
export function transcriptProblem(raw: string): TranscriptProblem | null {
  const text = normalizeTranscript(raw);
  if (!text) {
    return 'empty';
  }
  if ([...text].length > MAX_TRANSCRIPT_CHARS) {
    return 'too-long';
  }
  return null;
}

export function transcriptProblemMessage(problem: TranscriptProblem): string {
  if (problem === 'empty') {
    return '这次没有识别出文字，请按住再说一次。';
  }
  return `识别出的文字太长了（超过 ${MAX_TRANSCRIPT_CHARS} 字），请说得短一点再试。`;
}

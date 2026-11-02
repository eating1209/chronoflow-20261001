import { describe, expect, it } from 'vitest';

import { channelLabel, describeFailure } from '../src/modules/asr/domain/asr';
import { toSimplified } from '../src/modules/asr/domain/chinese';
import {
  HOLD_THRESHOLD_MS,
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  SLIDE_CANCEL_PX,
  formatDuration,
  outcomeOfRelease,
  phaseAfterMove,
  phaseAfterPressIn,
} from '../src/modules/asr/domain/holdToTalk';
import {
  MAX_TRANSCRIPT_CHARS,
  normalizeTranscript,
  transcriptProblem,
  transcriptProblemMessage,
} from '../src/modules/asr/domain/transcript';
import { VoiceTranscriptionError, transcribeRecording } from '../src/modules/asr/service';
import { ApiError } from '../src/shared/api';

/**
 * 语音输入里**能在 node 里测的那一半**：按住说话状态机、转写文字归一、
 * 繁转简、云端转写与失败话术。
 *
 * <p>2026-11-01 已移除离线识别：现在只有云端通道，失败就是失败，
 * 不再有「本机兜底」的编排要测。
 */

describe('云端通道与失败话术', () => {
  it('通道名称是「云端识别」', () => {
    expect(channelLabel('cloud')).toBe('云端识别');
  });

  it('失败话术包含原因，并明确提示语音需要联网', () => {
    const message = describeFailure([
      { channel: 'cloud', message: '服务暂时不可用，请稍后重试' },
    ]);
    expect(message).toContain('服务暂时不可用');
    expect(message).toContain('联网');
    expect(message).toContain('直接把文字打出来');
  });

  it('没有任何失败记录时也给一句可执行的提示', () => {
    expect(describeFailure([])).toContain('检查网络');
  });
});

describe('按住说话的状态机', () => {
  it('按下先进入 holding，等 200ms 才真正开录', () => {
    expect(phaseAfterPressIn()).toBe('holding');
    expect(HOLD_THRESHOLD_MS).toBeGreaterThan(0);
  });

  it('录音中上滑超过阈值进入取消态，滑回来恢复录音', () => {
    expect(phaseAfterMove('recording', -SLIDE_CANCEL_PX - 1)).toBe('cancelling');
    expect(phaseAfterMove('recording', -SLIDE_CANCEL_PX + 1)).toBe('recording');
    expect(phaseAfterMove('cancelling', -10)).toBe('recording');
  });

  it('还没开始录音时上滑不改变状态（权限窗期间不该显示「松手取消」）', () => {
    expect(phaseAfterMove('holding', -200)).toBe('holding');
  });

  it('取消态松手 → 取消，不转写', () => {
    expect(outcomeOfRelease('cancelling', MAX_RECORD_MS)).toEqual({ kind: 'cancel' });
  });

  it('按得太短（还没开录就松手）→ 提示按住说话', () => {
    expect(outcomeOfRelease('holding', 0).kind).toBe('hint');
  });

  it('录到了但不足 500ms → 提示太短，不浪费一次转写', () => {
    const outcome = outcomeOfRelease('recording', MIN_RECORD_MS - 1);
    expect(outcome).toEqual({ kind: 'hint', message: '说话时间太短，请按住再说一次' });
  });

  it('正常松手 → 去转写', () => {
    expect(outcomeOfRelease('recording', MIN_RECORD_MS)).toEqual({ kind: 'transcribe' });
  });

  it('识别中又按一下不会打断本次识别', () => {
    expect(outcomeOfRelease('transcribing', 5000).kind).toBe('hint');
  });

  it('计时显示是 分:秒', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(3_400)).toBe('0:03');
    expect(formatDuration(65_000)).toBe('1:05');
  });
});

describe('转写文字的归一与校验', () => {
  it('去掉首尾空白、合并多余空格与空行，不往中文里插空格', () => {
    expect(normalizeTranscript('  明天下午三点   和张总开会 \n\n')).toBe('明天下午三点 和张总开会');
  });

  it('空字符串 / 纯空白 → empty', () => {
    expect(transcriptProblem('')).toBe('empty');
    expect(transcriptProblem('  \n\t ')).toBe('empty');
    expect(transcriptProblemMessage('empty')).toContain('再说一次');
  });

  it('正常长度可用', () => {
    expect(transcriptProblem('明天下午三点和张总开会')).toBeNull();
  });

  it('超过上限判 too-long（防止录到整段会议后白跑一次模型）', () => {
    const long = '会'.repeat(MAX_TRANSCRIPT_CHARS + 1);
    expect(transcriptProblem(long)).toBe('too-long');
    expect(transcriptProblemMessage('too-long')).toContain(String(MAX_TRANSCRIPT_CHARS));
  });

  it('长度按码点算：emoji 不会被当成两个字', () => {
    const text = '😀'.repeat(MAX_TRANSCRIPT_CHARS);
    expect(transcriptProblem(text)).toBeNull();
  });
});

describe('繁体转简体', () => {
  it('云端偶尔返回的繁体也会转成简体', () => {
    expect(toSimplified('開會 臺灣 明天下午三點')).toBe('开会 台湾 明天下午三点');
  });

  it('本来就是简体时保持不变', () => {
    expect(toSimplified('明天下午三点开会')).toBe('明天下午三点开会');
  });

  it('空文本原样返回', () => {
    expect(toSimplified('')).toBe('');
  });
});

describe('云端转写', () => {
  it('成功时文字会被归一化并转简体', async () => {
    const api = {
      transcribeAudio: async () => ({ text: '  明天下午三點開會  ', language: 'zh' }),
    };
    const result = await transcribeRecording('file:///tmp/a.wav', api);
    expect(result.channel).toBe('cloud');
    expect(result.text).toBe('明天下午三点开会');
  });

  it('云端失败 → VoiceTranscriptionError，话术提示联网', async () => {
    const api = {
      transcribeAudio: async () => {
        throw new ApiError(90002, '语音识别未配置');
      },
    };
    await expect(transcribeRecording('file:///tmp/a.wav', api))
      .rejects.toBeInstanceOf(VoiceTranscriptionError);
    await expect(transcribeRecording('file:///tmp/a.wav', api))
      .rejects.toThrow(/联网/);
  });

  it('云端返回空文字也算失败', async () => {
    const api = { transcribeAudio: async () => ({ text: '   ' }) };
    await expect(transcribeRecording('file:///tmp/a.wav', api))
      .rejects.toThrow(/没有识别到文字/);
  });
});

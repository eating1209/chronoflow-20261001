/**
 * 「按住说话」的状态机（纯逻辑）。
 *
 * <p>时序（与归档里的 `agentMicImpl.tsx` 同一套，2026-10 用户实测过）：
 * 按下 → 200ms 后才算真的「要说话」（太短是误触）→ 申请权限 → 开始录音 →
 * 松手结束；**按住期间上滑超过阈值 = 取消**。
 *
 * <p>为什么把这几个判断单独抽出来：它们全是「松手时才见分晓」的边界条件，
 * 组件里写成一串 if 就没法测，而真机上最容易错的恰恰是这些边界
 * （松手太早、权限窗还没回来就松手、上滑后又滑回来）。
 */

/** 按住超过这么久才触发录音；低于它按「误触」处理。 */
export const HOLD_THRESHOLD_MS = 200;

/** 上滑超过这个距离（像素）算取消。`dy` 向上为负。 */
export const SLIDE_CANCEL_PX = 60;

/** 太短的录音基本没有一个完整的词，转出来只会是噪音。 */
export const MIN_RECORD_MS = 500;

/**
 * 单次录音上限。
 *
 * <p>这是「语音指令」而不是「录音笔」：30 秒足够说清一句日程，
 * 也远低于服务端 60 秒 / 5 MB 的限制（16 kHz 单声道 30 秒约 960 KB）。
 */
export const MAX_RECORD_MS = 30_000;

export type HoldPhase = 'idle' | 'holding' | 'recording' | 'cancelling' | 'transcribing';

/** 手指按下的那一刻。 */
export function phaseAfterPressIn(): HoldPhase {
  return 'holding';
}

/**
 * 按住期间手指移动：只在「已经在录音」时才允许进出取消态。
 *
 * <p>按住但还没开始录音（权限窗还没回来）时，上滑不应该改变状态——
 * 那一小段里用户看到的是「继续按住」，此时把状态切到「松手取消」只会让人困惑。
 */
export function phaseAfterMove(phase: HoldPhase, dy: number): HoldPhase {
  if (phase !== 'recording' && phase !== 'cancelling') {
    return phase;
  }
  return dy <= -SLIDE_CANCEL_PX ? 'cancelling' : 'recording';
}

export type ReleaseOutcome =
  | { kind: 'hint'; message: string }
  | { kind: 'cancel' }
  | { kind: 'transcribe' };

/**
 * 松手时该做什么。
 *
 * <p>`durationMs` 是**已经录到的时长**（不是按住时长）：权限窗可能弹了几秒，
 * 那几秒没有音频，不能算进去，否则会把一段 200ms 的误触当成有效录音。
 */
export function outcomeOfRelease(phase: HoldPhase, durationMs: number): ReleaseOutcome {
  if (phase === 'cancelling') {
    return { kind: 'cancel' };
  }
  if (phase === 'holding') {
    // 还没开始录（按得太短，或权限窗期间就松手了）
    return { kind: 'hint', message: '按住说话，松手结束' };
  }
  if (phase !== 'recording') {
    // transcribing：用户又按了一下，忽略就好
    return { kind: 'hint', message: '正在识别，请稍候' };
  }
  if (durationMs < MIN_RECORD_MS) {
    return { kind: 'hint', message: '说话时间太短，请按住再说一次' };
  }
  return { kind: 'transcribe' };
}

/** 录音计时显示：`0:03`。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

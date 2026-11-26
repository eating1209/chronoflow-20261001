/**
 * 「语音输入日程」页（spec §4.1.9.1）。
 *
 * <p>交互照微信那套「按住说话」：按住 → 计时 + 音量提示 → 松手 → 识别；
 * **按住期间上滑 = 取消**。五种状态与成员 4 的分工一致：
 * 按住说话 / 录音中 / 上滑取消 / 识别中 / 失败。
 *
 * <p>识别结果**先落在可编辑的文本框里**，用户看一眼（识别会错），
 * 再点「识别成日程」交给 `/ai/events/parse-text`，然后进入与拍照识别共用的确认页。
 * 不自动跳确认页：转错了字，用户至少还能在这儿改。
 *
 * <p>录音文件用完即删：它只服务于这一次转写。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppTheme, useRuntime } from '../../../context/AppContext';
import { userFacingError } from '../../../shared/errors';
import { askPermission } from '../../../shared/permission';
import { Card, EditorHeader, PrimaryButton, Screen } from '../../../shared/ui';
import { APP_TIMEZONE, localDateKey } from '../../calendar/pure';
import { draftsFromItems, type RecognizedDraft } from '../../vision';
import { channelLabel, type AsrChannel } from '../domain/asr';
import {
  HOLD_THRESHOLD_MS,
  MAX_RECORD_MS,
  formatDuration,
  outcomeOfRelease,
  phaseAfterMove,
  type HoldPhase,
} from '../domain/holdToTalk';
import { transcriptProblem, transcriptProblemMessage } from '../domain/transcript';
import {
  cancelPcmRecording,
  deleteRecording,
  pcmRecorderAvailable,
  pcmRecorderUnavailableReason,
  startPcmRecording,
  stopPcmRecording,
  type RecordingFile,
} from '../recording/pcmRecorder';
import { VoiceTranscriptionError, transcribeRecording } from '../service';

export function VoiceInputScreen({
  onCancel,
  onReviewDrafts,
}: {
  onCancel: () => void;
  /** 解析出的草稿交给确认页（与拍照识别共用 EventImportScreen） */
  onReviewDrafts: (drafts: RecognizedDraft[]) => void;
}) {
  const theme = useAppTheme();
  const { api } = useRuntime();
  const today = useMemo(() => localDateKey(new Date().toISOString(), APP_TIMEZONE), []);

  const [phase, setPhase] = useState<HoldPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [channel, setChannel] = useState<AsrChannel | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const phaseRef = useRef<HoldPhase>('idle');
  const touchActive = useRef(false);
  const startedAt = useRef(0);
  const durationRef = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const updatePhase = useCallback((next: HoldPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  /** 结束录音 → 判断是取消 / 太短 / 去转写。 */
  const finishRecording = useCallback(async () => {
    const cancelling = phaseRef.current === 'cancelling';
    clearTimers();

    let file: RecordingFile | null = null;
    try {
      if (cancelling) {
        await cancelPcmRecording();
        updatePhase('idle');
        setElapsedMs(0);
        return;
      }
      file = await stopPcmRecording();
    } catch (cause) {
      updatePhase('idle');
      setElapsedMs(0);
      setError(cause instanceof Error ? cause.message : '录音结束失败，请重试');
      return;
    }

    if (!file) {
      updatePhase('idle');
      return;
    }
    const recorded = file;
    const duration = recorded.durationMs || durationRef.current;
    const outcome = outcomeOfRelease('recording', duration);
    if (outcome.kind === 'hint') {
      await deleteRecording(recorded.uri);
      updatePhase('idle');
      setElapsedMs(0);
      setHint(outcome.message);
      return;
    }

    updatePhase('transcribing');
    setHint(null);
    setError(null);
    try {
      const result = await transcribeRecording(recorded.uri, api);
      setTranscript(result.text);
      setChannel(result.channel);
      setTookMs(result.elapsedMs);
      updatePhase('idle');
    } catch (cause) {
      updatePhase('idle');
      setError(
        cause instanceof VoiceTranscriptionError
          ? cause.message
          : userFacingError(cause, '语音转文字失败，请重试'),
      );
    } finally {
      // 隐私边界：录音只用于这一次转写，成功失败都删
      await deleteRecording(recorded.uri);
    }
  }, [api, clearTimers, updatePhase]);

  /** 按下 200ms 后真正开始：先说明用途、再申请系统权限、再录。 */
  const beginRecording = useCallback(async () => {
    if (!touchActive.current || phaseRef.current !== 'holding') {
      return;
    }
    const granted = await askPermission('microphone');
    if (!granted) {
      updatePhase('idle');
      return;
    }
    // 权限窗期间用户很可能已经松手：不能在没按住的时候开始录音
    // （否则会一直录到 30 秒上限，用户看到的是「麦克风自己录了半分钟」）
    if (!touchActive.current || phaseRef.current !== 'holding') {
      return;
    }
    if (!pcmRecorderAvailable()) {
      updatePhase('idle');
      setError(pcmRecorderUnavailableReason());
      return;
    }
    try {
      await startPcmRecording();
    } catch (cause) {
      updatePhase('idle');
      setError(cause instanceof Error ? cause.message : '录音启动失败');
      return;
    }
    // 启动是异步的：这几百毫秒里用户也可能松手了。再判一次，
    // 否则会「松手之后才开始录」，一直录到 30 秒上限。
    if (!touchActive.current || phaseRef.current !== 'holding') {
      await cancelPcmRecording();
      updatePhase('idle');
      return;
    }
    startedAt.current = Date.now();
    durationRef.current = 0;
    setElapsedMs(0);
    updatePhase('recording');
    ticker.current = setInterval(() => {
      const value = Date.now() - startedAt.current;
      durationRef.current = value;
      setElapsedMs(value);
      if (value >= MAX_RECORD_MS) {
        touchActive.current = false;
        void finishRecording();
      }
    }, 100);
  }, [finishRecording, updatePhase]);

  const handleRelease = useCallback(() => {
    touchActive.current = false;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    const current = phaseRef.current;
    if (current === 'recording' || current === 'cancelling') {
      void finishRecording();
      return;
    }
    if (current === 'holding') {
      updatePhase('idle');
      setHint('按住说话，松手结束');
    }
  }, [finishRecording, updatePhase]);

  const handleMove = useCallback((dy: number) => {
    const current = phaseRef.current;
    if (current !== 'recording' && current !== 'cancelling') {
      return;
    }
    const next = phaseAfterMove(current, dy);
    if (next !== current) {
      updatePhase(next);
    }
  }, [updatePhase]);

  /**
   * PanResponder 的 handlers 在创建时固定，真正逻辑走 ref：
   * 否则每次渲染（计时器每 100ms 一次）都要重建 responder，手势会被打断。
   *
   * <p>**必须挂在普通 View 上，不能挂 Pressable**：Pressable 自己的
   * `usePressability` 会覆盖同名的 responder 回调（归档代码里踩过，
   * 表现是长按完全没反应）。
   */
  const handlers = useRef({
    begin: (): void => undefined,
    move: (_dy: number): void => undefined,
    release: (): void => undefined,
  });
  handlers.current.begin = () => {
    if (phaseRef.current !== 'idle') {
      return;
    }
    touchActive.current = true;
    setHint(null);
    setError(null);
    updatePhase('holding');
    holdTimer.current = setTimeout(() => {
      void beginRecording();
    }, HOLD_THRESHOLD_MS);
  };
  handlers.current.move = handleMove;
  handlers.current.release = handleRelease;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => handlers.current.begin(),
      onPanResponderMove: (_event, gesture) => handlers.current.move(gesture.dy),
      onPanResponderRelease: () => handlers.current.release(),
      onPanResponderTerminate: () => handlers.current.release(),
    }),
  ).current;

  // 离开页面时一定要把麦克风停掉：否则会一直录到上限
  useEffect(() => () => {
    clearTimers();
    touchActive.current = false;
    if (phaseRef.current === 'recording' || phaseRef.current === 'cancelling') {
      void cancelPcmRecording();
    }
  }, [clearTimers]);

  const reset = () => {
    setTranscript('');
    setChannel(null);
    setTookMs(null);
    setHint(null);
    setError(null);
    setElapsedMs(0);
    updatePhase('idle');
  };

  const parseIntoEvents = useCallback(async () => {
    const problem = transcriptProblem(transcript);
    if (problem) {
      Alert.alert('还不能识别', transcriptProblemMessage(problem));
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const parsed = await api.parseScheduleText({
        text: transcript.trim(),
        today,
        timezone: APP_TIMEZONE,
      });
      const drafts = draftsFromItems(parsed.items);
      if (drafts.length === 0) {
        Alert.alert(
          '没找到要做的事',
          '这段话里没有找到可以变成日程的事情。可以换一种说法再说一次。',
        );
        return;
      }
      onReviewDrafts(drafts);
    } catch (cause) {
      Alert.alert('解析失败', userFacingError(cause, '这段文字没解析成日程，稍后再试'));
    } finally {
      setParsing(false);
    }
  }, [api, onReviewDrafts, today, transcript]);

  const active = phase === 'recording' || phase === 'cancelling';
  const label = {
    idle: '按住说话',
    holding: '继续按住…',
    recording: `正在录音 ${formatDuration(elapsedMs)}`,
    cancelling: '松手取消',
    transcribing: '识别中…',
  }[phase];

  return (
    <Screen>
      <EditorHeader title="语音输入" onCancel={onCancel} />

      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.md,
          paddingBottom: theme.spacing.xxl,
        }}
      >
        <Text style={[styles.lead, { color: theme.color.textSecondary }]}>
          按住说话，例如「明天下午三点和张总开会」。
          {'\n'}识别后可先改字，再生成日程。需要联网。
        </Text>

        <View style={styles.micWrap}>
          <View
            {...responder.panHandlers}
            accessibilityRole="button"
            accessibilityLabel="按住说话"
            accessibilityState={{ disabled: phase === 'transcribing' }}
            style={[
              styles.mic,
              {
                backgroundColor: active
                  ? (phase === 'cancelling' ? theme.color.danger : theme.color.accent)
                  : theme.color.surfaceRaised,
                borderColor: active ? 'transparent' : theme.color.border,
                opacity: phase === 'transcribing' ? 0.6 : 1,
              },
            ]}
          >
            <Ionicons
              name={phase === 'cancelling' ? 'close' : 'mic-outline'}
              size={44}
              color={active ? theme.color.accentContrast : theme.color.textPrimary}
            />
          </View>
          <Text style={[styles.phaseLabel, { color: theme.color.textPrimary }]}>{label}</Text>
          <Text style={[styles.phaseHint, { color: theme.color.textTertiary }]}>
            {phase === 'recording' || phase === 'cancelling'
              ? '上滑取消，松手结束'
              : `最长 ${MAX_RECORD_MS / 1000} 秒，松手识别`}
          </Text>
        </View>

        {hint ? (
          <Text style={[styles.feedback, { color: theme.color.textSecondary }]}>{hint}</Text>
        ) : null}
        {error ? (
          <Text style={[styles.feedback, { color: theme.color.danger }]}>{error}</Text>
        ) : null}

        {transcript ? (
          <Card style={{ marginTop: theme.spacing.lg }}>
            <View style={styles.resultHead}>
              <Text style={[styles.resultTitle, { color: theme.color.textPrimary }]}>识别结果</Text>
              <Text style={[styles.resultMeta, { color: theme.color.textTertiary }]}>
                {channel ? channelLabel(channel) : ''}
                {tookMs != null ? ` · ${(tookMs / 1000).toFixed(1)}s` : ''}
              </Text>
            </View>
            <TextInput
              value={transcript}
              onChangeText={setTranscript}
              multiline
              accessibilityLabel="识别出的文字，可修改"
              style={[
                styles.transcript,
                {
                  color: theme.color.textPrimary,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.bg,
                },
              ]}
            />
            <Text style={[styles.editHint, { color: theme.color.textTertiary }]}>
              识别可能有误，可先修改；解析需要联网。
            </Text>
          </Card>
        ) : null}

        {transcript ? (
          <View style={{ marginTop: theme.spacing.md }}>
            <PrimaryButton
              title={parsing ? '解析中…' : '识别成日程'}
              onPress={() => void parseIntoEvents()}
              loading={parsing}
              disabled={!transcript.trim()}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新说"
              onPress={reset}
              style={{ marginTop: theme.spacing.sm, paddingVertical: theme.spacing.sm }}
            >
              <Text style={[styles.secondary, { color: theme.color.textSecondary }]}>重新说</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[styles.privacy, { color: theme.color.textTertiary }]}>
          录音仅用于本次转写，完成后立即删除。
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: {
    fontSize: 14,
    lineHeight: 22,
  },
  micWrap: {
    alignItems: 'center',
    marginTop: 32,
  },
  mic: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseLabel: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
  },
  phaseHint: {
    marginTop: 6,
    fontSize: 13,
  },
  feedback: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  resultHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  resultMeta: {
    fontSize: 12,
  },
  transcript: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  editHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
  },
  secondary: {
    fontSize: 15,
    textAlign: 'center',
  },
  privacy: {
    marginTop: 24,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});

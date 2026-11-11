import { useEffect, useState } from 'react';
import { userFacingError } from '../../../shared/errors';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Screen, showToast } from '../../../shared/ui';
import {
  EditorHeader,
  FormInput,
  FormRow,
  FormRowValue,
  FormRowText,
  FormTextArea,
  LargeSegmentedControl,
  useKeyboardAwareScroll,
} from '../../../shared/ui';
import { useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import { WheelDatePicker, WheelLayer, WheelTimePicker } from '../../calendar/components';
import {
  buildRrule,
  describeRecurrence,
  parseRrule,
  type Recurrence,
  type RecurrenceSelection,
  type ReminderSelection,
  type EditorSwitchSnapshot,
  type PlaceSelection,
} from '../../calendar/pure';
import {
  describeReminderSound,
  describeReminders,
  normalizeReminders,
  persistReminderSettings,
  parseReminderSound,
  refreshLocalReminders,
  type ReminderSound,
} from '../../notifications';
import {
  buildCreateTaskPayload,
  buildUpdateTaskPayload,
  draftFromTask,
  emptyTaskDraft,
  switchSnapshotFromTaskDraft,
  validateTaskDraft,
  type TaskDraft,
} from '../domain/taskDraft';

/**
 * 新建 / 编辑待办：**独立整页**（spec §4.1.5）。
 *
 * 新建与编辑共用同一页：字段一致，分两页只会让两边逐渐长歪。
 * 待办比日程多一个特性——截止时间可以不存在（归入「待安排」），
 * 所以用显式开关表达，而不是让用户去猜空输入框是什么意思。
 */
export function TaskEditorScreen({
  todayKey,
  taskId,
  initialDraft,
  placeSelection,
  recurrenceSelection,
  reminderSelection,
  initialReminderSound,
  showKindSwitch = false,
  onSwitchToEvent,
  onPickLocation,
  onPickRecurrence,
  onPickReminder,
  onCancel,
  onSaved,
}: {
  todayKey: string;
  /** 传了就是编辑已有待办 */
  taskId?: number;
  /** 从「日程」切过来时带回的草稿；新建时也用它预填 */
  initialDraft?: TaskDraft;
  /** 地点二级页回传；version 变化才算用户重新选了一次 */
  placeSelection: PlaceSelection;
  recurrenceSelection: RecurrenceSelection;
  reminderSelection: ReminderSelection;
  /** 新建页从「日程」切过来时带回的提醒声音档位 */
  initialReminderSound?: ReminderSound;
  /** 只有新建时才显示「日程 / 待办」切换；编辑已有内容不显示 */
  showKindSwitch?: boolean;
  onSwitchToEvent?: (snapshot: EditorSwitchSnapshot) => void;
  onPickLocation: () => void;
  /** 第二个参数是待办的截止日期，用来算「每周默认勾哪天」 */
  onPickRecurrence: (current: Recurrence, startDateKey: string) => void;
  onPickReminder: (current: { minutes: number[]; sound: ReminderSound }) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const theme = useAppTheme();
  const { api, reminders } = useRuntime();
  const { scrollRef, keyboardHeight, scrollToEnd } = useKeyboardAwareScroll();
  const { notificationEnabled, reminderSound: defaultReminderSound } = useAppSessionState();
  const isEdit = typeof taskId === 'number';

  const [draft, setDraft] = useState<TaskDraft>(() => initialDraft ?? emptyTaskDraft(todayKey));
  /** 打开编辑页时服务端上的提醒设置（用于「没改过就不多发一次 PUT」） */
  const [initialReminders, setInitialReminders] = useState<number[]>([]);
  /** 提醒方式（静音 / 消息提醒 / 闹钟），按这条待办走；新建时用偏好里的默认档 */
  const [reminderSound, setReminderSound] = useState<ReminderSound>(
    initialReminderSound ?? defaultReminderSound,
  );
  const [initialReminderSoundState, setInitialReminderSoundState] =
    useState<ReminderSound>(initialReminderSound ?? defaultReminderSound);
  /** 正在用滚轮改哪一栏（null = 没开选择层） */
  const [wheelField, setWheelField] = useState<'dueDate' | 'dueTime' | null>(null);
  const [wheelDraft, setWheelDraft] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 从地点选择页返回时并入草稿。依赖 version 而不是 place：
  // 连续两次选「不设地点」时值都是 null，只比较值无法触发同步。
  useEffect(() => {
    if (placeSelection.version === 0) {
      return;
    }
    setDraft((current) => ({ ...current, place: placeSelection.place }));
  }, [placeSelection.version, placeSelection.place]);

  useEffect(() => {
    if (!isEdit || taskId === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const task = await api.taskDetail(taskId);
        if (!cancelled) {
          setDraft(draftFromTask(task, todayKey));
        }
        /**
         * 提醒不在 task 行上（spec §4.5 的分工）：`draftFromTask` 只能给空数组，
         * 真正的值要单独拉一次 `GET /reminders`。拉失败就当没设提醒，不打断编辑。
         */
        try {
          const loaded = await api.reminders('TASK', taskId);
          if (!cancelled) {
            const minutes = normalizeReminders(loaded.map((item) => item.minutesBefore));
            const sound = parseReminderSound(loaded[0]?.sound);
            setInitialReminders(minutes);
            setInitialReminderSoundState(sound);
            setReminderSound(sound);
            setDraft((current) => ({ ...current, reminders: minutes }));
          }
        } catch {
          // 提醒读不到就当没有
        }
      } catch (cause) {
        if (!cancelled) {
          setError(userFacingError(cause, '加载待办失败'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, isEdit, taskId, todayKey]);

  /** 改动草稿时顺手清掉上一次的错误提示（否则改对了红字还挂着，像没改对） */
  const patch = (next: Partial<TaskDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  };

  const openWheel = (field: 'dueDate' | 'dueTime') => {
    setWheelDraft(field === 'dueDate' ? draft.dueDate : draft.dueTime);
    setWheelField(field);
  };
  const confirmWheel = () => {
    if (wheelField === 'dueDate') {
      patch({ dueDate: wheelDraft });
    } else if (wheelField === 'dueTime') {
      patch({ dueTime: wheelDraft });
    }
    setWheelField(null);
  };

  // 从「重复」页返回（同样只在按下「完成」时才生效）
  useEffect(() => {
    if (recurrenceSelection.version === 0 || !recurrenceSelection.recurrence) {
      return;
    }
    // 不重复要提交空串而不是 null：PATCH 里 null 是「不修改」
    const rrule = buildRrule(recurrenceSelection.recurrence) ?? '';
    setDraft((current) => ({ ...current, rrule }));
  }, [recurrenceSelection.version, recurrenceSelection.recurrence]);

  // 从「提醒」页返回
  useEffect(() => {
    if (reminderSelection.version === 0) {
      return;
    }
    setDraft((current) => ({ ...current, reminders: normalizeReminders(reminderSelection.minutes) }));
    setReminderSound(reminderSelection.sound);
  }, [reminderSelection.version, reminderSelection.minutes, reminderSelection.sound]);

  const recurrence = parseRrule(draft.rrule, draft.dueDate);

  const save = async () => {
    const validation = validateTaskDraft(draft);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let savedId: number;
      if (taskId === undefined) {
        const created = await api.createTask(buildCreateTaskPayload(draft));
        savedId = created.id;
      } else {
        await api.updateTask(taskId, buildUpdateTaskPayload(draft));
        savedId = taskId;
      }
      try {
        await persistReminderSettings({
          api,
          targetType: 'TASK',
          targetId: savedId,
          minutes: draft.reminders,
          initialMinutes: initialReminders,
          sound: reminderSound,
          initialSound: initialReminderSoundState,
        });
        setInitialReminders(normalizeReminders(draft.reminders));
        setInitialReminderSoundState(reminderSound);
      } catch (cause) {
        setError(
          `待办已保存，但提醒没有存上：${userFacingError(cause, '请稍后重试')}`,
        );
        return;
      }
      const local = await refreshLocalReminders({
        api,
        scheduler: reminders,
        enabled: notificationEnabled,
      });
      if (local.permissionDenied && draft.reminders.length > 0) {
        Alert.alert('提醒不会响', '系统还没允许本应用发送通知，请在系统设置里打开通知权限。');
      }
      showToast(isEdit ? '待办已更新' : '待办已添加');
      onSaved();
    } catch (cause) {
      setError(userFacingError(cause, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (taskId === undefined) {
      return;
    }
    Alert.alert('删除这条待办？', '删除后无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSaving(true);
            setError(null);
            try {
              await api.deleteTask(taskId);
              // 本机那条排期要跟着消失：重排一次，服务端已经不再返回它
              await refreshLocalReminders({ api, scheduler: reminders, enabled: notificationEnabled });
              showToast('待办已删除');
              onSaved();
            } catch (cause) {
              setError(userFacingError(cause, '删除失败'));
            } finally {
              setSaving(false);
            }
          })();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Screen>
        <EditorHeader title="编辑待办" onCancel={onCancel} onSave={() => {}} saving />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <EditorHeader
        title={isEdit ? '编辑待办' : showKindSwitch ? '新建安排' : '新建待办'}
        onCancel={onCancel}
        onSave={() => void save()}
        saving={saving}
      />

      {showKindSwitch ? (
        <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm }}>
          <LargeSegmentedControl
            label="安排类型"
            options={[
              { value: 'EVENT', label: '日程' },
              { value: 'TASK', label: '待办' },
            ]}
            value="TASK"
            disabled={saving}
            onChange={(next) => {
              if (next === 'EVENT') {
                onSwitchToEvent?.(switchSnapshotFromTaskDraft(draft, todayKey, reminderSound));
              }
            }}
          />
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          padding: theme.spacing.md,
          paddingBottom: theme.spacing.xxl + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <Card>
          <FormInput
            value={draft.title}
            onChangeText={(title) => patch({ title })}
            placeholder="待办标题"
            accessibilityLabel="待办标题"
            fontSize={18}
            autoFocus={!isEdit}
          />
        </Card>

        <View style={{ marginTop: theme.spacing.md }}>
          <Card>
            <FormRow label="截止时间">
              <Switch
                value={draft.hasDue}
                onValueChange={(hasDue) => patch({ hasDue })}
                accessibilityLabel="设置截止时间"
                trackColor={{ false: theme.color.border, true: theme.color.accent }}
                thumbColor={theme.color.surfaceRaised}
              />
            </FormRow>

            {draft.hasDue ? (
              <>
                {/* 日期与时间都走滚轮：手机上手打 YYYY-MM-DD / HH:mm 又慢又容易错（spec §4.1.5） */}
                <FormRow label="日期" onPress={() => openWheel('dueDate')}>
                  <FormRowValue text={draft.dueDate} placeholder="选择日期" />
                </FormRow>
                {/* 没有「全天」开关：拨到 00:00 就是「就这一天」 */}
                <FormRow label="时间" onPress={() => openWheel('dueTime')}>
                  <FormRowValue text={draft.dueTime} placeholder="09:00" />
                </FormRow>

                {/*
                  重复与提醒只在「有截止时间」时出现：没有时间点的待办是「待安排」，
                  「每周五」这种规则与「提前十分钟」都没有可依附的时刻。
                */}
                <FormRow
                  label="重复"
                  onPress={() => onPickRecurrence(parseRrule(draft.rrule, draft.dueDate), draft.dueDate)}
                >
                  <FormRowValue
                    text={recurrence.frequency === 'NONE' ? null : describeRecurrence(recurrence)}
                    placeholder="不重复"
                  />
                </FormRow>

                <FormRow
                  label="提醒"
                  onPress={() =>
                    onPickReminder({
                      minutes: normalizeReminders(draft.reminders),
                      sound: reminderSound,
                    })
                  }
                >
                  <FormRowValue
                    text={
                      draft.reminders.length > 0
                        ? `${describeReminders(draft.reminders)} · ${describeReminderSound(reminderSound)}`
                        : null
                    }
                    placeholder="不提醒"
                  />
                </FormRow>
              </>
            ) : null}

            <FormRow label="地点" onPress={onPickLocation}>
              <FormRowValue text={draft.place?.name ?? null} placeholder="添加地点" />
            </FormRow>
            {/* 地图常常只定位到楼，教室 / 门牌由用户手填（与地点都可空，spec §5.9） */}
            <FormRow label="详细地址" last>
              <FormRowText
                value={draft.locationDetail}
                placeholder="3 号楼 305（选填）"
                onChangeText={(locationDetail) => patch({ locationDetail })}
                onFocus={scrollToEnd}
              />
            </FormRow>
          </Card>
        </View>

        {draft.place?.address ? (
          <Text style={{ color: theme.color.textTertiary, fontSize: 12, marginTop: 6, marginLeft: 4 }}>
            {draft.place.address}
          </Text>
        ) : null}

        {!draft.hasDue ? (
          <Text style={{ color: theme.color.textTertiary, fontSize: 12, marginTop: 6, marginLeft: 4 }}>
            未设截止时间的待办会归入「待安排」
          </Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.md }}>
          <Card>
            <FormTextArea
              value={draft.description}
              placeholder="添加备注…"
              onChangeText={(description) => patch({ description })}
              onFocus={scrollToEnd}
            />
          </Card>
        </View>

        {draft.place ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除地点"
            onPress={() => patch({ place: null })}
          >
            <Text style={{ color: theme.color.textTertiary, fontSize: 13, marginTop: theme.spacing.md }}>
              清除地点
            </Text>
          </Pressable>
        ) : null}

        {error ? (
          <Text style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.spacing.md }}>{error}</Text>
        ) : null}

        {isEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="删除待办"
            onPress={remove}
            disabled={saving}
            style={[
              styles.delete,
              { borderColor: theme.color.border, borderRadius: theme.radius.button, marginTop: theme.spacing.lg },
            ]}
          >
            <Text style={{ color: theme.color.danger, fontSize: 15 }}>删除待办</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* 日期 / 时间选择层（spec §7.6.7：日期时间选择用弹层） */}
      {wheelField ? (
        <WheelLayer
          title={wheelField === 'dueDate' ? '截止日期' : '截止时间'}
          onCancel={() => setWheelField(null)}
          onConfirm={confirmWheel}
        >
          {wheelField === 'dueDate' ? (
            <WheelDatePicker value={wheelDraft} onChange={setWheelDraft} />
          ) : (
            <WheelTimePicker value={wheelDraft} onChange={setWheelDraft} />
          )}
        </WheelLayer>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  delete: { borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
});

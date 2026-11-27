import { useCallback, useEffect, useMemo, useState } from 'react';
import { userFacingError } from '../../../shared/errors';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { EventOccurrence, Task } from '../../../shared/api';
import { Screen } from '../../../shared/ui';
import { useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import {
  APP_TIMEZONE,
  dateKeyToIso,
  localDateKey,
  sortTasks,
} from '../../calendar/pure';
import { refreshLocalReminders } from '../../notifications';
import { syncTaskToSystemCalendar } from '../../calendar/system';
import { CompletedTasksCard } from '../components/CompletedTasksCard';
import { TaskOverviewCard } from '../components/TaskOverviewCard';
import { eventOverviewEntry, taskOverviewEntry } from '../domain/taskOverview';
import { subscribeTaskBarChanges, syncTaskBarNotification } from '../taskBarNotification';

/**
 * 待办页展示未来一年的日程实例。
 *
 * 无限重复日程不能真的「展开到永远」，一年已覆盖用户会按月浏览的范围；
 * 待办不受这个窗口限制，所有未完成项都会出现在列表里。
 */
const OVERVIEW_EVENT_WINDOW_DAYS = 365;

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
}

export function TasksScreen({
  onCreateTask,
  onOpenTask,
  onOpenEvent,
}: {
  onCreateTask: () => void;
  onOpenTask: (taskId: number) => void;
  onOpenEvent: (eventId: number, dateKey: string, occurrenceDate: string | null) => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { notificationEnabled, taskBarEnabled } = useAppSessionState();
  const { api, reminders } = useRuntime();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      const todayKey = localDateKey(new Date(now).toISOString(), APP_TIMEZONE);
      const endKey = localDateKey(
        new Date(now + OVERVIEW_EVENT_WINDOW_DAYS * 86_400_000).toISOString(),
        APP_TIMEZONE,
      );
      const [taskList, eventList] = await Promise.all([
        api.tasks(),
        api
          .eventsInRange(dateKeyToIso(todayKey), dateKeyToIso(endKey, true))
          .catch(() => [] as EventOccurrence[]),
      ]);
      setTasks(taskList);
      // 总览只放未完成的安排；已完成日程在日历页仍保留，便于当天回看。
      const visibleEvents = eventList.filter(
        (event) => !event.done && Date.parse(event.at) >= now,
      );
      setEvents(visibleEvents);
      void syncTaskBarNotification({
        api,
        enabled: taskBarEnabled,
        tasks: taskList,
        events: visibleEvents,
        now,
      });
    } catch (cause) {
      setError(userFacingError(cause, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [api, taskBarEnabled]);

  // 从编辑页返回时重新拉取，新建的待办才会立刻出现
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // 锁屏 / 通知栏里完成的条目同步到服务端后，当前页要重新拉一遍。
  useEffect(() => subscribeTaskBarChanges(() => void load()), [load]);

  const toggle = async (task: Task) => {
    // 乐观更新：先改本地状态，失败再回滚，避免勾选时有网络等待感
    const next: Task['status'] = task.status === 'DONE' ? 'TODO' : 'DONE';
    const completedAt = next === 'DONE' ? new Date().toISOString() : null;
    const nextTasks = tasks.map((item) =>
      item.id === task.id ? { ...item, status: next, completedAt } : item,
    );
    setTasks(nextTasks);
    void syncTaskBarNotification({
      api,
      enabled: taskBarEnabled,
      tasks: nextTasks,
      events,
      now: Date.now(),
    });
    try {
      await api.completeTask(task.id, next === 'DONE');
      await syncTaskToSystemCalendar({ ...task, status: next, completedAt });
    } catch {
      await load();
    }
  };

  const toggleEvent = async (event: EventOccurrence) => {
    const nextEvents = events.filter(
      (item) =>
        item.eventId !== event.eventId || item.occurrenceDate !== event.occurrenceDate,
    );
    setEvents(nextEvents);
    void syncTaskBarNotification({
      api,
      enabled: taskBarEnabled,
      tasks,
      events: nextEvents,
      now: Date.now(),
    });
    try {
      await api.completeEvent(event.eventId, true, event.occurrenceDate);
    } catch (cause) {
      await load();
      setError(userFacingError(cause, '日程没有完成，请重试'));
      return;
    }
    try {
      // 完成状态已经落库；提醒同步失败不能让刚勾掉的日程重新出现在列表里。
      await refreshLocalReminders({ api, scheduler: reminders, enabled: notificationEnabled });
    } catch {
      setError('日程已完成，但本机提醒暂时没有同步，请稍后下拉刷新。');
    }
  };

  const ordered = useMemo(() => sortTasks(tasks), [tasks]);
  const open = useMemo(() => ordered.filter((task) => task.status === 'TODO'), [ordered]);
  const completed = useMemo(
    () => ordered.filter((task) => task.status === 'DONE'),
    [ordered],
  );
  const now = Date.now();
  const todayKey = localDateKey(new Date(now).toISOString(), APP_TIMEZONE);
  const [, todayMonth, todayDay] = todayKey.split('-').map(Number) as [number, number, number];
  const overviewEntries = useMemo(
    () => [
      ...open.map(taskOverviewEntry),
      ...events.filter((event) => !event.done).map(eventOverviewEntry),
    ],
    [events, open],
  );
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.md,
          paddingTop: insets.top + theme.spacing.sm,
          paddingBottom: theme.spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        <View style={styles.pageHeader}>
          <Text style={[styles.eyebrow, { color: theme.color.textSecondary }]}>
            {weekdayOf(todayKey)} · 未来安排
          </Text>
          <View style={styles.titleRow}>
            <Text style={[styles.pageTitle, { color: theme.color.textPrimary }]}>
              {todayMonth}月{todayDay}日
            </Text>
            <Text style={{ color: theme.color.textSecondary, fontSize: 12 }}>
              共 {overviewEntries.length} 项
            </Text>
          </View>
        </View>

        {error ? (
          <Text style={{ color: theme.color.danger, fontSize: 13, marginBottom: 12 }}>{error}</Text>
        ) : null}

        {!loading && overviewEntries.length === 0 && completed.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <TasksEmptyState />
          </View>
        ) : null}

        {overviewEntries.length > 0 ? (
          <TaskOverviewCard
            entries={overviewEntries}
            now={now}
            onOpenTask={onOpenTask}
            onOpenEvent={(event) =>
              onOpenEvent(
                event.eventId,
                localDateKey(event.at, APP_TIMEZONE),
                event.occurrenceDate,
              )
            }
            onToggleTask={(task) => void toggle(task)}
            onToggleEvent={(event) => void toggleEvent(event)}
          />
        ) : null}

        {completed.length > 0 ? (
          <CompletedTasksCard
            tasks={completed}
            onOpenTask={onOpenTask}
            onToggleTask={(task) => void toggle(task)}
          />
        ) : null}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="新建待办"
        onPress={onCreateTask}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: theme.color.accent,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          },
        ]}
      >
        <Text style={[styles.fabPlus, { color: theme.color.accentContrast }]}>＋</Text>
      </Pressable>
    </Screen>
  );
}

function TasksEmptyState() {
  const theme = useAppTheme();
  return (
    <View style={styles.emptyState}>
      <View
        style={[
          styles.emptyNote,
          { backgroundColor: theme.color.surfaceRaised, borderColor: theme.color.border },
        ]}
      >
        <View style={[styles.emptyLine, { backgroundColor: theme.color.border }]} />
        <View style={[styles.emptyLine, { backgroundColor: theme.color.border }]} />
        <View style={[styles.emptyLineShort, { backgroundColor: theme.color.border }]} />
        <View style={[styles.emptyCheck, { backgroundColor: theme.color.accent }]}>
          <Ionicons name="checkmark" size={17} color={theme.color.accentContrast} />
        </View>
      </View>
      <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
        目前还没有待办哦
      </Text>
      <Text style={[styles.emptyHint, { color: theme.color.textSecondary }]}>
        点右下角 ＋，记下第一件事
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pageHeader: { marginBottom: 16 },
  eyebrow: { fontSize: 11.5, marginBottom: 3 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  pageTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPlus: { fontSize: 28, lineHeight: 32 },
  emptyState: { alignItems: 'center', paddingBottom: 48 },
  emptyNote: {
    width: 76,
    height: 88,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 24,
    marginBottom: 24,
  },
  emptyLine: { height: 1.5, borderRadius: 1, marginBottom: 9 },
  emptyLineShort: { width: '62%', height: 1.5, borderRadius: 1 },
  emptyCheck: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  emptyHint: { fontSize: 11.5, marginTop: 8 },
});

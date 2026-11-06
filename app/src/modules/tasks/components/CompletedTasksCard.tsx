import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Task } from '../../../shared/api';
import { Card } from '../../../shared/ui';
import { useAppTheme } from '../../../context/AppContext';
import { APP_TIMEZONE, localDateKey } from '../../calendar/pure';

/**
 * 页面最底部的已完成区。
 *
 * 已完成待办不再从列表里消失，而是弱化后收在最后；点勾选可以恢复成待办。
 * 没有已完成项时整个区块不渲染，避免占位置。
 */
export function CompletedTasksCard({
  tasks,
  onOpenTask,
  onToggleTask,
}: {
  tasks: Task[];
  onOpenTask: (taskId: number) => void;
  onToggleTask: (task: Task) => void;
}) {
  const theme = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(
    () =>
      [...tasks].sort((left, right) => {
        const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0;
        const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0;
        return (
          (Number.isFinite(rightTime) ? rightTime : 0) -
          (Number.isFinite(leftTime) ? leftTime : 0)
        );
      }),
    [tasks],
  );
  const todayCompletedCount = useMemo(() => {
    const todayKey = localDateKey(new Date().toISOString(), APP_TIMEZONE);
    return ordered.filter((task) => {
      if (!task.completedAt) {
        return false;
      }
      return localDateKey(task.completedAt, APP_TIMEZONE) === todayKey;
    }).length;
  }, [ordered]);

  if (ordered.length === 0) {
    return null;
  }

  if (!expanded) {
    return (
      <View style={{ marginBottom: 6 }}>
        <Card style={styles.collapsedCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`查看已完成 ${ordered.length} 项`}
            accessibilityState={{ expanded: false }}
            onPress={() => setExpanded(true)}
            style={({ pressed }) => [styles.collapsedRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={[styles.doneBadge, { backgroundColor: theme.color.textPrimary }]}>
              <Ionicons name="checkmark" size={14} color={theme.color.surfaceRaised} />
            </View>
            <Text style={{ color: theme.color.textPrimary, fontSize: 14, fontWeight: '700' }}>
              已完成 {ordered.length} 项
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.todayCount, { color: theme.color.textSecondary }]}
            >
              今天完成 {todayCompletedCount} 项
            </Text>
            <View style={styles.spacer} />
            <Text style={{ color: theme.color.textSecondary, fontSize: 11 }}>查看</Text>
            <Ionicons name="chevron-forward" size={14} color={theme.color.textTertiary} />
          </Pressable>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: theme.spacing.lg }}>
      <View style={styles.heading}>
        <View style={styles.headingLeft}>
          <Text style={[styles.title, { color: theme.color.textPrimary }]}>已完成</Text>
          <Text style={{ color: theme.color.textTertiary, fontSize: 11 }}>{ordered.length} 项</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收起已完成"
          accessibilityState={{ expanded: true }}
          hitSlop={8}
          onPress={() => setExpanded(false)}
          style={({ pressed }) => [styles.collapseButton, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Text style={{ color: theme.color.textSecondary, fontSize: 11 }}>收起</Text>
          <Ionicons name="chevron-up" size={14} color={theme.color.textTertiary} />
        </Pressable>
      </View>

      <Card style={styles.card}>
        {ordered.map((task, index) => (
          <View
            key={task.id}
            style={[
              styles.row,
              index > 0
                ? {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.color.border,
                  }
                : null,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`编辑已完成待办 ${task.title}`}
              onPress={() => onOpenTask(task.id)}
              style={({ pressed }) => [styles.body, { opacity: pressed ? 0.62 : 1 }]}
            >
              <View style={[styles.bar, { backgroundColor: theme.color.textTertiary }]} />
              <View style={styles.text}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.color.textSecondary,
                    fontSize: 14.5,
                    fontWeight: '700',
                    textDecorationLine: 'line-through',
                  }}
                >
                  {task.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: theme.color.textTertiary, fontSize: 10.5, marginTop: 3 }}
                >
                  {completedAtLabel(task.completedAt)}
                </Text>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`取消完成待办 ${task.title}`}
              accessibilityState={{ checked: true }}
              hitSlop={10}
              onPress={() => onToggleTask(task)}
              style={({ pressed }) => [styles.checkTouch, { opacity: pressed ? 0.55 : 1 }]}
            >
              <View style={[styles.checkCircle, { backgroundColor: theme.color.textSecondary }]}>
                <Ionicons name="checkmark" size={13} color={theme.color.surfaceRaised} />
              </View>
            </Pressable>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsedCard: { padding: 0, overflow: 'hidden' },
  collapsedRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 15,
  },
  doneBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCount: { flexShrink: 0, fontSize: 10.5 },
  spacer: { flex: 1 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  headingLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  collapseButton: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  card: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 58 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  bar: { width: 4, height: 38, borderRadius: 2, marginLeft: 16, marginRight: 10 },
  text: { flex: 1, minWidth: 0 },
  checkTouch: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  checkCircle: {
    width: 21,
    height: 21,
    borderRadius: 10.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function completedAtLabel(value: string | null, now: number = Date.now()): string {
  if (!value) {
    return '已完成';
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) {
    return '已完成';
  }
  const date = new Date(at);
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const dateKey = localDateKey(date.toISOString(), APP_TIMEZONE);
  const todayKey = localDateKey(new Date(now).toISOString(), APP_TIMEZONE);
  const yesterdayKey = localDateKey(new Date(now - 86_400_000).toISOString(), APP_TIMEZONE);
  if (dateKey === todayKey) {
    return `今天 ${time}`;
  }
  if (dateKey === yesterdayKey) {
    return `昨天 ${time}`;
  }
  const monthDay = new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIMEZONE,
    month: 'numeric',
    day: 'numeric',
  }).format(date);
  return `${monthDay} ${time}`;
}

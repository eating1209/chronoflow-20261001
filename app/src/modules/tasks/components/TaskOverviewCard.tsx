import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { EventOccurrence, Task } from '../../../shared/api';
import { Card } from '../../../shared/ui';
import { useAppTheme } from '../../../context/AppContext';
import {
  APP_TIMEZONE,
  formatEventTimeRange,
  localDateKey,
  locationLabel,
} from '../../calendar/pure';
import {
  TASK_URGENCY_ORDER,
  formatTaskDue,
  groupTaskOverviewByMonth,
  groupTaskOverviewByUrgency,
  isOverdueAt,
  overviewEntryHasDetails,
  taskDateSectionLabel,
  urgencyForAt,
  type TaskOverviewEntry,
  type TaskOverviewLayout,
  type TaskUrgency,
} from '../domain/taskOverview';

const URGENCY_LABEL: Record<TaskUrgency, string> = {
  urgent: '紧急',
  soon: '临近',
  calm: '从容',
};

const UNSCHEDULED_PREVIEW_COUNT = 3;

/**
 * 待办页主视图。
 *
 * 页面顺序固定为：逾期提示、待安排、已排期的月份列表。三色条只统计未来有日期
 * 的安排，并且是筛选入口；选中颜色后，无日期的待安排和逾期提示都暂时收起。
 */
export function TaskOverviewCard({
  entries,
  now,
  onOpenTask,
  onOpenEvent,
  onToggleTask,
  onToggleEvent,
}: {
  entries: TaskOverviewEntry[];
  now: number;
  onOpenTask: (taskId: number) => void;
  onOpenEvent: (event: EventOccurrence) => void;
  onToggleTask: (task: Task) => void;
  onToggleEvent: (event: EventOccurrence) => void;
}) {
  const theme = useAppTheme();
  const [selectedUrgency, setSelectedUrgency] = useState<TaskUrgency | null>(null);
  const [allUnscheduledShown, setAllUnscheduledShown] = useState(false);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const todayKey = localDateKey(new Date(now).toISOString(), APP_TIMEZONE);

  const layout = useMemo(
    () => groupTaskOverviewByMonth(entries, now, APP_TIMEZONE),
    [entries, now],
  );
  const futureEntries = useMemo(
    () => layout.months.flatMap((month) => month.entries),
    [layout.months],
  );
  const urgencyGroups = useMemo(
    () => groupTaskOverviewByUrgency(futureEntries, now),
    [futureEntries, now],
  );
  const visibleLayout = useMemo(
    () => filterLayoutByUrgency(layout, selectedUrgency, now),
    [layout, now, selectedUrgency],
  );
  const visibleFutureEntries = useMemo(
    () => visibleLayout.months.flatMap((month) => month.entries),
    [visibleLayout.months],
  );
  const visibleUnscheduled = useMemo(() => {
    if (selectedUrgency) {
      return [];
    }
    if (allUnscheduledShown) {
      return layout.unscheduled;
    }
    return layout.unscheduled.slice(0, UNSCHEDULED_PREVIEW_COUNT);
  }, [allUnscheduledShown, layout.unscheduled, selectedUrgency]);

  const colorFor = (urgency: TaskUrgency) =>
    urgency === 'urgent'
      ? theme.color.danger
      : urgency === 'soon'
        ? theme.color.warning
        : theme.color.success;
  const openEntry = (entry: TaskOverviewEntry) =>
    entry.kind === 'task' ? onOpenTask(entry.task.id) : onOpenEvent(entry.event);
  const toggleEntry = (entry: TaskOverviewEntry) =>
    entry.kind === 'task' ? onToggleTask(entry.task) : onToggleEvent(entry.event);

  const earliest = futureEntries[0] ?? null;
  const earliestColor = earliest ? colorFor(urgencyForAt(earliest.at, now)) : theme.color.success;
  const eventCount = futureEntries.filter((entry) => entry.kind === 'event').length;
  const taskCount = futureEntries.length - eventCount;

  return (
    <View>
      {futureEntries.length > 0 ? (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <View style={styles.summaryHeader}>
            <Text style={[styles.summaryTitle, { color: theme.color.textPrimary }]}>任务总览</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="显示全部有日期的任务"
              hitSlop={8}
              onPress={() => setSelectedUrgency(null)}
              style={({ pressed }) => [styles.allButton, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Text style={{ color: theme.color.textSecondary, fontSize: 11.5 }}>
                {selectedUrgency
                  ? `${URGENCY_LABEL[selectedUrgency]} ${urgencyGroups[selectedUrgency].length} 项`
                  : `未来 ${futureEntries.length} 项`}
              </Text>
              {selectedUrgency ? (
                <Ionicons name="chevron-down" size={12} color={theme.color.textSecondary} />
              ) : null}
            </Pressable>
          </View>

          <View style={[styles.barTrack, { backgroundColor: theme.color.border }]}>
            {TASK_URGENCY_ORDER.map((bucket) => {
              const count = urgencyGroups[bucket].length;
              if (count === 0) {
                return null;
              }
              return (
                <Pressable
                  key={bucket}
                  accessibilityRole="button"
                  accessibilityLabel={`查看${URGENCY_LABEL[bucket]}任务 ${count} 项`}
                  accessibilityState={{ selected: selectedUrgency === bucket }}
                  hitSlop={{ top: 6, bottom: 6 }}
                  onPress={() =>
                    setSelectedUrgency((current) => (current === bucket ? null : bucket))
                  }
                  style={[
                    styles.segment,
                    { flex: count, backgroundColor: colorFor(bucket) },
                    bucket !== 'calm' ? styles.segmentGap : null,
                  ]}
                />
              );
            })}
          </View>

          <View style={styles.legendRow}>
            {TASK_URGENCY_ORDER.map((bucket) => (
              <Pressable
                key={bucket}
                accessibilityRole="button"
                accessibilityLabel={`查看${URGENCY_LABEL[bucket]}任务 ${urgencyGroups[bucket].length} 项`}
                accessibilityState={{
                  selected: selectedUrgency === bucket,
                  disabled: urgencyGroups[bucket].length === 0,
                }}
                disabled={urgencyGroups[bucket].length === 0}
                onPress={() =>
                  setSelectedUrgency((current) => (current === bucket ? null : bucket))
                }
                style={[
                  styles.legendItem,
                  { opacity: urgencyGroups[bucket].length === 0 ? 0.38 : 1 },
                ]}
              >
                <Text
                  style={{
                    color:
                      selectedUrgency === bucket
                        ? theme.color.textPrimary
                        : theme.color.textSecondary,
                    fontSize: 10.5,
                    fontWeight: selectedUrgency === bucket ? '700' : '400',
                  }}
                >
                  {URGENCY_LABEL[bucket]}{' '}
                  <Text style={{ color: colorFor(bucket), fontWeight: '700' }}>
                    {urgencyGroups[bucket].length}
                  </Text>
                </Text>
              </Pressable>
            ))}
          </View>

          {earliest ? (
            <>
              <View style={[styles.summaryDivider, { backgroundColor: theme.color.border }]} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`打开最近截止任务 ${entryTitle(earliest)}`}
                onPress={() => openEntry(earliest)}
                style={({ pressed }) => [styles.recentRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={{ color: theme.color.textSecondary, fontSize: 10.5 }}>最近截止</Text>
                <Text
                  numberOfLines={1}
                  style={{ color: earliestColor, fontSize: 11.5, fontWeight: '700' }}
                >
                  {entryTiming(earliest, now, false)}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: theme.color.textPrimary, fontSize: 11.5, flex: 1 }}
                >
                  {entryTitle(earliest)}
                </Text>
              </Pressable>
            </>
          ) : null}

          <View style={styles.summaryMeta}>
            <Text style={{ color: theme.color.textTertiary, fontSize: 10.5 }}>
              {eventCount} 项日程 · {taskCount} 项待办
            </Text>
            {earliest ? (
              <Text style={{ color: theme.color.textTertiary, fontSize: 10.5 }}>
                最早 {entryTiming(earliest, now, false)}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {!selectedUrgency && layout.overdue.length > 0 ? (
        overdueExpanded ? (
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <View style={styles.headingLeft}>
                <Text style={[styles.sectionTitle, { color: theme.color.danger }]}>已逾期</Text>
                <Text style={{ color: theme.color.textTertiary, fontSize: 11 }}>
                  {layout.overdue.length} 项
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="收起已逾期任务"
                accessibilityState={{ expanded: true }}
                hitSlop={8}
                onPress={() => setOverdueExpanded(false)}
                style={({ pressed }) => [styles.collapseButton, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Text style={{ color: theme.color.textSecondary, fontSize: 11 }}>收起</Text>
                <Ionicons name="chevron-up" size={14} color={theme.color.textTertiary} />
              </Pressable>
            </View>
            <Card style={styles.cardFlush}>
              {layout.overdue.map((entry, index) => (
                <OverviewRow
                  key={entry.key}
                  entry={entry}
                  now={now}
                  showDate
                  showTopBorder={index > 0}
                  onOpen={() => openEntry(entry)}
                  onToggle={() => toggleEntry(entry)}
                />
              ))}
            </Card>
          </View>
        ) : (
          <View style={styles.collapsedSection}>
            <Card style={styles.collapsedCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`查看已逾期 ${layout.overdue.length} 项`}
                accessibilityState={{ expanded: false }}
                onPress={() => setOverdueExpanded(true)}
                style={({ pressed }) => [styles.collapsedRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={[styles.warningBadge, { backgroundColor: theme.color.danger }]}>
                  <Ionicons name="alert" size={13} color={theme.color.surfaceRaised} />
                </View>
                <Text style={{ color: theme.color.danger, fontSize: 14, fontWeight: '700' }}>
                  已逾期 {layout.overdue.length} 项
                </Text>
                <Text numberOfLines={1} style={[styles.collapsedMeta, { color: theme.color.textSecondary }]}>
                  最早 {overdueAgeLabel(layout.overdue[0]?.at ?? null, now)}
                </Text>
                <View style={styles.spacer} />
                <Text style={{ color: theme.color.textSecondary, fontSize: 11 }}>查看</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.color.textTertiary} />
              </Pressable>
            </Card>
          </View>
        )
      ) : null}

      {!selectedUrgency && layout.unscheduled.length > 0 ? (
        <View style={[styles.section, styles.unscheduledSection]}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>待安排</Text>
            <Text style={{ color: theme.color.textTertiary, fontSize: 11 }}>
              {layout.unscheduled.length} 项
            </Text>
          </View>
          <Card style={styles.cardFlush}>
            {visibleUnscheduled.map((entry, index) => (
              <OverviewRow
                key={entry.key}
                entry={entry}
                now={now}
                showDate={false}
                showTopBorder={index > 0}
                onOpen={() => openEntry(entry)}
                onToggle={() => toggleEntry(entry)}
              />
            ))}
            {layout.unscheduled.length > UNSCHEDULED_PREVIEW_COUNT ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  allUnscheduledShown
                    ? '收起待安排'
                    : `查看全部 ${layout.unscheduled.length} 项待安排`
                }
                accessibilityState={{ expanded: allUnscheduledShown }}
                onPress={() => setAllUnscheduledShown((current) => !current)}
                style={({ pressed }) => [
                  styles.moreRow,
                  { borderTopColor: theme.color.border, opacity: pressed ? 0.55 : 1 },
                ]}
              >
                <Text style={{ color: theme.color.textSecondary, fontSize: 11.5 }}>
                  {allUnscheduledShown
                    ? '收起'
                    : `查看全部 ${layout.unscheduled.length} 项`}
                </Text>
                <Ionicons
                  name={allUnscheduledShown ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={theme.color.textTertiary}
                />
              </Pressable>
            ) : null}
          </Card>
        </View>
      ) : null}

      {selectedUrgency && visibleFutureEntries.length === 0 ? (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <Text style={{ color: theme.color.textSecondary, fontSize: 12.5 }}>
            这一组暂无有日期的安排，点上方“全部”可恢复。
          </Text>
        </Card>
      ) : null}

      {visibleLayout.months.map((month) => (
        <View key={month.monthKey} style={styles.section}>
          <View style={styles.monthHeading}>
            <Text style={[styles.monthTitle, { color: theme.color.textPrimary }]}>
              {month.year}年{month.month}月
            </Text>
            <Text style={{ color: theme.color.textTertiary, fontSize: 10.5 }}>
              {month.entries.length} 项安排
            </Text>
          </View>

          <Card style={styles.cardFlush}>
            {month.dates.map((date, dateIndex) => {
              const label = taskDateSectionLabel(date.dateKey, todayKey);
              return (
                <View key={date.dateKey} style={styles.dateRow}>
                  <View style={styles.dateColumn}>
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.82}
                      style={{
                        color: label.isToday ? theme.color.danger : theme.color.textPrimary,
                        fontSize: 11.5,
                        fontWeight: '700',
                      }}
                    >
                      {label.primary}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ color: theme.color.textTertiary, fontSize: 10, marginTop: 2 }}
                    >
                      {label.secondary}
                    </Text>
                  </View>
                  <View style={[styles.dateDivider, { backgroundColor: theme.color.border }]} />
                  <View style={{ flex: 1 }}>
                    {date.entries.map((entry, entryIndex) => (
                      <OverviewRow
                        key={entry.key}
                        entry={entry}
                        now={now}
                        showDate={false}
                        showTopBorder={dateIndex > 0 || entryIndex > 0}
                        onOpen={() => openEntry(entry)}
                        onToggle={() => toggleEntry(entry)}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      ))}
    </View>
  );
}

function OverviewRow({
  entry,
  now,
  showDate,
  showTopBorder,
  onOpen,
  onToggle,
}: {
  entry: TaskOverviewEntry;
  now: number;
  showDate: boolean;
  showTopBorder: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const theme = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const unscheduled = entry.at === null;
  const overdue = isOverdueAt(entry.at, now);
  const urgency = urgencyForAt(entry.at, now);
  const color = overdue
    ? theme.color.textSecondary
    : unscheduled
      ? theme.color.textTertiary
      : urgency === 'urgent'
        ? theme.color.danger
        : urgency === 'soon'
          ? theme.color.warning
          : theme.color.success;
  const isTask = entry.kind === 'task';
  const title = entryTitle(entry);
  const type = isTask ? '待办' : '日程';
  const location = isTask
    ? locationLabel(entry.task.locationName ?? null, entry.task.locationDetail ?? null)
    : locationLabel(entry.event.locationName, entry.event.locationDetail);
  const note = (isTask ? entry.task.description : entry.event.description)?.trim() ?? '';
  const linkedEvent = isTask ? (entry.task.eventTitle?.trim() ?? '') : '';
  const hasDetails = overviewEntryHasDetails(entry);
  const timing = entryTiming(entry, now, showDate);
  const meta = unscheduled
    ? `${type} · 未设置截止时间`
    : overdue || showDate
      ? `${type} · ${timing}`
      : `${timing} · ${type} · ${URGENCY_LABEL[urgency]}`;
  const detailLines = [
    location ? `地点  ${location}` : null,
    note ? `备注  ${note}` : null,
    linkedEvent ? `关联日程  ${linkedEvent}` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <View
      style={[
        styles.entryRow,
        showTopBorder
          ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border }
          : null,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isTask ? '编辑待办' : '打开日程'} ${title}`}
        onPress={onOpen}
        style={({ pressed }) => [styles.entryBody, { opacity: pressed ? 0.62 : 1 }]}
      >
        <View style={[styles.entryBar, { backgroundColor: color }]} />
        <View style={styles.entryText}>
          <Text
            numberOfLines={1}
            style={{ color: theme.color.textPrimary, fontSize: 13.5, fontWeight: '700' }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: theme.color.textSecondary, fontSize: 10.5, marginTop: 3 }}
          >
            {meta}
          </Text>
        </View>
      </Pressable>

      {hasDetails ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? '收起' : '展开'} ${title} 详情`}
          accessibilityState={{ expanded }}
          hitSlop={6}
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [styles.arrowTouch, { opacity: pressed ? 0.55 : 1 }]}
        >
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={17}
            color={theme.color.textTertiary}
          />
        </Pressable>
      ) : (
        <View style={styles.arrowTouch} />
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${isTask ? '完成待办' : '完成日程'} ${title}`}
        accessibilityState={{ checked: false }}
        hitSlop={6}
        onPress={onToggle}
        style={({ pressed }) => [styles.checkTouch, { opacity: pressed ? 0.55 : 1 }]}
      >
        <View style={[styles.checkCircle, { borderColor: color }]}>
          {isTask ? null : <Ionicons name="calendar-outline" size={12} color={color} />}
        </View>
      </Pressable>

      {expanded && hasDetails ? (
        <View style={styles.detailBlock}>
          {detailLines.map((line) => (
            <Text
              key={line}
              numberOfLines={line.startsWith('备注') ? 2 : 1}
              style={{ color: theme.color.textSecondary, fontSize: 10.5, lineHeight: 15 }}
            >
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function entryTitle(entry: TaskOverviewEntry): string {
  return entry.kind === 'task' ? entry.task.title : entry.event.title;
}

function entryTiming(entry: TaskOverviewEntry, now: number, showDate: boolean): string {
  if (!entry.at) {
    return '待安排';
  }
  if (entry.kind === 'event') {
    return formatEventTimeRange(entry.event, entry.event.timezone || APP_TIMEZONE);
  }
  return showDate ? formatTaskDue(entry.at, now) : clockInTimezone(entry.at, APP_TIMEZONE);
}

function clockInTimezone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function overdueAgeLabel(at: string | null, now: number): string {
  if (!at) {
    return '时间未知';
  }
  const time = Date.parse(at);
  if (!Number.isFinite(time)) {
    return '时间未知';
  }
  const hours = Math.max(1, Math.floor((now - time) / 3_600_000));
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
}

function filterLayoutByUrgency(
  layout: TaskOverviewLayout,
  selected: TaskUrgency | null,
  now: number,
): TaskOverviewLayout {
  if (!selected) {
    return layout;
  }
  const matches = (entry: TaskOverviewEntry) =>
    !isOverdueAt(entry.at, now) && urgencyForAt(entry.at, now) === selected;
  return {
    overdue: [],
    unscheduled: [],
    months: layout.months.flatMap((month) => {
      const entries = month.entries.filter(matches);
      if (entries.length === 0) {
        return [];
      }
      return [
        {
          ...month,
          entries,
          dates: month.dates
            .map((date) => ({ ...date, entries: date.entries.filter(matches) }))
            .filter((date) => date.entries.length > 0),
        },
      ];
    }),
  };
}

const styles = StyleSheet.create({
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryTitle: { fontSize: 15, fontWeight: '700' },
  allButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  barTrack: { height: 18, borderRadius: 9, overflow: 'hidden', flexDirection: 'row' },
  segment: { height: 18 },
  segmentGap: { marginRight: 2 },
  legendRow: { flexDirection: 'row', marginTop: 7 },
  legendItem: { flex: 1 },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginTop: 10, marginBottom: 9 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 22 },
  summaryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  collapsedCard: { padding: 0, overflow: 'hidden' },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 52,
    paddingHorizontal: 15,
  },
  warningBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedMeta: { flexShrink: 0, fontSize: 10.5 },
  spacer: { flex: 1 },
  headingLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  collapseButton: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  section: { marginBottom: 12 },
  collapsedSection: { marginBottom: 6 },
  unscheduledSection: { marginBottom: 6 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  monthHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  monthTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  cardFlush: { padding: 0, overflow: 'hidden' },
  dateRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 54 },
  dateColumn: {
    width: 60,
    paddingTop: 11,
    paddingLeft: 9,
    paddingRight: 2,
    paddingBottom: 8,
  },
  dateDivider: { width: StyleSheet.hairlineWidth, marginVertical: 7 },
  entryRow: { flexDirection: 'row', alignItems: 'center', minHeight: 54, flexWrap: 'wrap' },
  entryBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 10,
    minWidth: 0,
  },
  entryBar: { width: 3.5, height: 32, borderRadius: 2, marginRight: 10 },
  entryText: { flex: 1, minWidth: 0 },
  checkTouch: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowTouch: { width: 28, height: 44, alignItems: 'center', justifyContent: 'center' },
  detailBlock: {
    width: '100%',
    paddingLeft: 29,
    paddingRight: 10,
    paddingBottom: 8,
    gap: 2,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

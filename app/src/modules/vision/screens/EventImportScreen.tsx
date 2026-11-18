import { useCallback, useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { userFacingError } from '../../../shared/errors';
import { Card, PrimaryButton, Screen } from '../../../shared/ui';
import { EditorHeader } from '../../../shared/ui';
import { useAppTheme, useRuntime } from '../../../context/AppContext';
import {
  APP_TIMEZONE,
  buildCreatePayload,
  localDateKey,
  type EventDraft,
} from '../../calendar/pure';
import {
  syncEventToSystemCalendar,
  syncTaskToSystemCalendar,
} from '../../calendar/systemCalendar';
import {
  buildCreateTaskPayload,
  taskDraftFromRecognized,
  type TaskDraft,
} from '../../tasks';
import { draftDateKey, draftToEventDraft, type RecognizedDraft } from '../domain/vision';

/**
 * 「图片 / 语音识别安排」的**确认页**（spec §4.1.9）。
 *
 * 模型会看错，直接写进日历比看错本身更糟——所以识别结果一律先摆在这里：
 * **点任意一条进整页编辑器**，整页里能改的比在这儿就地改的多。
 * 服务端会先判断每条是日程还是待办；确认页把两类混排展示，添加时分别写进日历 / 待办。
 * 日程没识别到具体日期时先标成「日期待定」，点开补一下即可；待办没有截止时间会进入「待安排」。
 * 逐条创建，全部成功后返回；部分失败只留失败的让用户重试，成功的不会重复创建。
 */

type EventImportRow = {
  kind: 'EVENT';
  key: string;
  /** 与编辑日程同一套字段，用户在编辑器里改的就是它 */
  draft: EventDraft;
  /** 这条日程落在哪一天；null = 通知里没写日期、用户还没补 */
  dateKey: string | null;
};

type TaskImportRow = {
  kind: 'TASK';
  key: string;
  /** 与编辑待办同一套字段；hasDue=false 表示进「待安排」 */
  draft: TaskDraft;
};

type ImportRow = EventImportRow | TaskImportRow;

/** 点开一条草稿时交给导航层的信息。 */
export type DraftEditTarget =
  | { kind: 'EVENT'; draft: EventDraft; dateKey: string | null }
  | { kind: 'TASK'; draft: TaskDraft };

/** 编辑器保存后回传的结果：按 key 把这些内容写回对应的那一行。 */
export type DraftEdit =
  | { version: number; key: string; kind: 'EVENT'; draft: EventDraft; dateKey: string }
  | { version: number; key: string; kind: 'TASK'; draft: TaskDraft };

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return `${year} 年 ${month} 月 ${day} 日`;
}

function rowsFromDrafts(drafts: RecognizedDraft[], todayKey: string): ImportRow[] {
  return drafts.map((draft, index) => {
    const key = `${index}-${draft.title}`;
    if (draft.kind === 'TASK') {
      return {
        kind: 'TASK',
        key,
        draft: taskDraftFromRecognized(draft, todayKey),
      };
    }
    return {
      kind: 'EVENT',
      key,
      draft: draftToEventDraft(draft),
      dateKey: draftDateKey(draft),
    };
  });
}

export function EventImportScreen({
  drafts,
  draftEdit,
  onEditDraft,
  onCancel,
  onAdded,
}: {
  drafts: RecognizedDraft[];
  /** 从草稿编辑器回来的结果（version 变了才生效，与编辑页的二级页回传同一套语义） */
  draftEdit?: DraftEdit | null;
  onEditDraft: (key: string, target: DraftEditTarget) => void;
  onCancel: () => void;
  /** 全部条目都写进服务端后调用（返回日历页） */
  onAdded: () => void;
}) {
  const theme = useAppTheme();
  const { api } = useRuntime();
  const todayKey = localDateKey(new Date().toISOString(), APP_TIMEZONE);

  const [rows, setRows] = useState<ImportRow[]>(() => rowsFromDrafts(drafts, todayKey));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventCount = rows.filter((row) => row.kind === 'EVENT').length;
  const taskCount = rows.length - eventCount;
  const missingDates = rows.filter((row) => row.kind === 'EVENT' && !row.dateKey).length;
  const missingTitles = rows.filter((row) => !row.draft.title.trim()).length;
  const canAdd = rows.length > 0 && missingDates === 0 && missingTitles === 0 && !saving;

  // 从草稿编辑器回来：把改好的草稿写回对应那一行
  useEffect(() => {
    if (!draftEdit || draftEdit.version === 0) {
      return;
    }
    setRows((current) =>
      current.map((row) => {
        if (row.key !== draftEdit.key || row.kind !== draftEdit.kind) {
          return row;
        }
        if (row.kind === 'EVENT' && draftEdit.kind === 'EVENT') {
          return { ...row, draft: draftEdit.draft, dateKey: draftEdit.dateKey };
        }
        if (row.kind === 'TASK' && draftEdit.kind === 'TASK') {
          return { ...row, draft: draftEdit.draft };
        }
        return row;
      }),
    );
    setError(null);
  }, [draftEdit]);

  const addAll = useCallback(async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    // 逐条创建（顺序建，失败时能明确知道是哪几条没成），成功的从列表里去掉，
    // 只留失败的让用户重试——重试成功的那些再建一遍会变成重复安排
    const failed: ImportRow[] = [];
    const failures: string[] = [];
    for (const row of rows) {
      if (!row.draft.title.trim()) {
        failed.push(row);
        continue;
      }
      try {
        if (row.kind === 'EVENT') {
          if (!row.dateKey) {
            failed.push(row);
            continue;
          }
          const created = await api.createEvent({
            ...buildCreatePayload(row.dateKey, row.draft),
            timezone: APP_TIMEZONE,
          });
          await syncEventToSystemCalendar(created);
        } else {
          const created = await api.createTask(buildCreateTaskPayload(row.draft));
          // 待办也按「单向导出」同步到系统日历；没有截止时间时由同步层跳过
          await syncTaskToSystemCalendar(created);
        }
      } catch (cause) {
        failed.push(row);
        const label = row.kind === 'EVENT' ? '日程' : '待办';
        failures.push(`${label}「${row.draft.title}」：${userFacingError(cause, '创建失败')}`);
      }
    }
    setSaving(false);
    if (failed.length === 0) {
      onAdded();
      return;
    }
    setRows(failed);
    setError(`有 ${failed.length} 条没有添加成功：\n${failures.join('\n')}`);
  }, [api, onAdded, rows, saving]);

  const count = rows.length;

  return (
    <Screen>
      <EditorHeader
        title="核对识别结果"
        onCancel={onCancel}
        onSave={() => void addAll()}
        saving={saving}
        saveLabel={`添加 ${count} 条`}
        cancelLabel="取消"
      />

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.md, paddingBottom: theme.spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: theme.color.textSecondary, fontSize: 13, marginBottom: theme.spacing.sm }}>
          {`已识别 ${eventCount} 条日程、${taskCount} 条待办。模型可能看错，点条目可修改；没有具体日期的会标为「日期待定」。`}
        </Text>

        {rows.map((row) => {
          const kindLabel = row.kind === 'EVENT' ? '日程' : '待办';
          const kindColor = row.kind === 'EVENT' ? theme.color.accent : theme.color.warning;
          const missingDate = row.kind === 'EVENT' && !row.dateKey;
          return (
            <View key={row.key} style={{ marginBottom: theme.spacing.sm }}>
              {/* 整张卡片可点：进整页编辑器（草稿模式）。删除按钮吃掉自己的点击 */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`编辑${kindLabel}草稿-${row.draft.title || '未命名'}`}
                onPress={() =>
                  onEditDraft(
                    row.key,
                    row.kind === 'EVENT'
                      ? { kind: 'EVENT', draft: row.draft, dateKey: row.dateKey }
                      : { kind: 'TASK', draft: row.draft },
                  )
                }
              >
                <Card>
                  <View style={styles.titleRow}>
                    <View
                      style={[
                        styles.kindBadge,
                        { borderColor: kindColor, borderRadius: theme.radius.button },
                      ]}
                    >
                      <Text style={{ color: kindColor, fontSize: 11, fontWeight: '600' }}>
                        {kindLabel}
                      </Text>
                    </View>
                    <Text
                      style={[styles.title, { color: theme.color.textPrimary }]}
                      numberOfLines={2}
                    >
                      {row.draft.title || '未命名'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`删除-${row.draft.title || '未命名'}`}
                      hitSlop={10}
                      onPress={() =>
                        setRows((current) => current.filter((item) => item.key !== row.key))
                      }
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.color.textTertiary} />
                    </Pressable>
                  </View>

                  <View style={styles.dateRow}>
                    <Text
                      style={{
                        // 日程没日期不能提交；待办没截止时间是合法状态，不要标红
                        color: missingDate
                          ? theme.color.warning
                          : row.kind === 'TASK' && !row.draft.hasDue
                            ? theme.color.textTertiary
                            : theme.color.textPrimary,
                        fontSize: 15,
                      }}
                    >
                      {row.kind === 'EVENT'
                        ? row.dateKey
                          ? `${formatDateKey(row.dateKey)} · ${row.draft.time}`
                          : '日期待定 · 点开补充'
                        : row.draft.hasDue
                          ? `${formatDateKey(row.draft.dueDate)} · ${row.draft.dueTime}`
                          : '待安排 · 未设截止时间'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.color.textTertiary} />
                  </View>

                  {row.draft.description ? (
                    <Text
                      numberOfLines={2}
                      style={{ color: theme.color.textTertiary, fontSize: 12, marginTop: 6 }}
                    >
                      {row.draft.description}
                    </Text>
                  ) : null}
                  {row.draft.place?.name ? (
                    <Text
                      numberOfLines={1}
                      style={{ color: theme.color.textTertiary, fontSize: 12, marginTop: 4 }}
                    >
                      地点：{row.draft.place.name}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            </View>
          );
        })}

        {error ? (
          <Text style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.spacing.sm }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.color.border }]}>
        {missingDates > 0 ? (
          <Text style={{ color: theme.color.danger, fontSize: 12, marginBottom: 8 }}>
            还有 {missingDates} 条日程缺日期，点卡片补充
          </Text>
        ) : null}
        {missingTitles > 0 ? (
          <Text style={{ color: theme.color.danger, fontSize: 12, marginBottom: 8 }}>
            还有 {missingTitles} 条没填标题
          </Text>
        ) : null}
        <PrimaryButton
          title={`添加 ${count} 条安排`}
          onPress={() => void addAll()}
          disabled={!canAdd}
          loading={saving}
        />
      </View>

      {saving ? (
        <View style={styles.savingOverlay} pointerEvents="auto">
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  kindBadge: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 7, paddingVertical: 2, marginTop: 2 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** 添加时盖住整页，避免用户连点两次建出重复安排 */
  savingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
});

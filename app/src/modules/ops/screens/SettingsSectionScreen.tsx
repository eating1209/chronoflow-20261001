import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';

import { EditorHeader, SegmentedControl } from '../../../shared/ui';
import { Chevron, ListGroup, ListRow, ListSeparator } from '../../../shared/ui';
import { Screen, showToast } from '../../../shared/ui';
import { userFacingError } from '../../../shared/errors';
import { useAppScheme, useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import { useFeatureFlags } from '../featureFlags';
import {
  describeReminderSound,
  refreshLocalReminders,
  useAppUpdate,
  type ReminderSound,
} from '../../notifications';
import { LEGAL_DOCS, OPERATOR_NAME, type LegalDoc } from '../../compliance/pure';
import { maskPhone } from '../../identity';
import type { TrainingDataPreference } from '../../../api/endpoints';
import { askPermission } from '../../../shared/permission';
import {
  backfillSystemCalendar,
  clearSystemCalendarEvents,
  setSystemCalendarEnabled,
  systemCalendarAvailable,
  systemCalendarEnabled,
} from '../../calendar/systemCalendar';
import {
  clearTaskBarNotification,
  requestTaskBarOverlayPermission,
  setTaskBarOverlayEnabled,
  syncTaskBarNotification,
  taskBarOverlayEnabled,
  taskBarOverlayPermissionGranted,
} from '../../tasks';

/** 「我的」页的五个分类。**每一个都是独立路由**（`SettingsSection`），不是在同一页里换内容。 */
export type SettingsSectionKey = 'account' | 'preferences' | 'support' | 'legal' | 'about';

export const SETTINGS_SECTION_TITLES: Record<SettingsSectionKey, string> = {
  account: '账号与安全',
  preferences: '偏好',
  support: '支持',
  legal: '隐私与合规',
  about: '关于',
};

/**
 * 「我的」页里某一类的**独立子页**。
 *
 * <p>为什么是独立路由而不是「同一页里 setSection 换内容」：后者没有转场、没有自己的返回栈，
 * **安卓的系统返回键会直接退出 App**（而不是回到「我的」）——用户一眼就看出不对。
 * 现在它和其它页面一样走导航，返回键、手势、转场都对。
 */
export function SettingsSectionScreen({
  section,
  onBack,
  onOpenRealName,
  onOpenEmail,
  onOpenPhoneChange,
  onOpenPassword,
  onOpenDeletion,
  onOpenFeedback,
  onOpenLegal,
}: {
  section: SettingsSectionKey;
  onBack: () => void;
  /** 实名认证是独立页（自己的 H5 流程），邮箱绑定也是——所以这里是两个各自的入口 */
  onOpenRealName: () => void;
  onOpenEmail: () => void;
  /** 切换手机号（要旧号 + 新号两个验证码，见 PhoneChangeScreen） */
  onOpenPhoneChange: () => void;
  /** 设置 / 修改登录密码（手机号 + 密码登录用，见 PasswordScreen） */
  onOpenPassword: () => void;
  onOpenDeletion: () => void;
  onOpenFeedback: () => void;
  onOpenLegal: (doc: LegalDoc) => void;
}) {
  const theme = useAppTheme();
  const scheme = useAppScheme();
  const { check: checkUpdate, currentVersionName } = useAppUpdate();
  const {
    toggleScheme,
    notificationEnabled,
    setNotificationEnabled,
    taskBarEnabled,
    setTaskBarEnabled,
  } = useAppSessionState();
  const { reminderSound, setReminderSound } = useAppSessionState();
  const { api, reminders } = useRuntime();
  /**
   * 后台「全局配置」里的功能开关（spec §5.7）：关掉哪个入口，这里就不渲染哪一行。
   * 读不到按开（见 domain/features），所以断网时行为与以前完全一致。
   */
  const features = useFeatureFlags();
  /** 账号与安全那一屏要显示「已实名 / 未绑定」这类状态，进这一屏时拉一次 */
  const [security, setSecurity] = useState<{
    phone: string;
    email: string | null;
    realName: string | null;
    realNameVerified: boolean;
    passwordSet: boolean;
  } | null>(null);
  const [trainingData, setTrainingData] = useState<TrainingDataPreference | null>(null);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const overlayRequestPending = useRef(false);
  const [calendarSyncOn, setCalendarSyncOn] = useState(false);
  const [calendarSyncBusy, setCalendarSyncBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (section === 'preferences') {
      void taskBarOverlayEnabled().then((enabled) => {
        if (alive) {
          setOverlayEnabled(enabled);
        }
      });
      void systemCalendarEnabled().then((enabled) => {
        if (alive) {
          setCalendarSyncOn(enabled);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [section, taskBarEnabled]);

  /** 从系统“显示在其他应用上层”页返回时，自动把刚才的开启动作做完。 */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (
        state !== 'active' ||
        section !== 'preferences' ||
        !overlayRequestPending.current
      ) {
        return;
      }
      void (async () => {
        const granted = await taskBarOverlayPermissionGranted();
        if (!granted) {
          return;
        }
        overlayRequestPending.current = false;
        const started = await setTaskBarOverlayEnabled(true);
        setOverlayEnabled(started);
      })();
    });
    return () => subscription.remove();
  }, [section]);

  /**
   * 用 `useFocusEffect` 而不是普通 `useEffect`：实名认证、邮箱绑定、换手机号都是**独立的二级页**，
   * 做完返回时这一屏还挂在栈里、组件不会重新挂载——普通 effect 只在 `[api, section]` 变化时跑，
   * 于是认证成功了回到这里还写着「未认证」。用户反馈的就是这个。
   *
   * 改成「每次重新获得焦点就重拉一次」，返回时自然是最新状态。
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (section === 'account') {
        void api
          .meSecurity()
          .then((view) => {
            if (alive) {
              setSecurity(view);
            }
          })
          .catch(() => {
            // 读不到就按「未认证 / 未绑定」显示：这只是状态展示，不拦着用户点进去
          });
      }
      if (section === 'legal') {
        void api
          .trainingData()
          .then((view) => {
            if (alive) {
              setTrainingData(view);
            }
          })
          .catch(() => {
            // 服务端还未升级时先不展示该开关，避免给用户一个点了就报错的入口
          });
      }
      return () => {
        alive = false;
      };
    }, [api, section]),
  );

  return (
<Screen>
      <EditorHeader title={SETTINGS_SECTION_TITLES[section]} cancelLabel="返回" onCancel={onBack} />
      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

      {section === 'account' ? (
        <ListGroup>
          {features.realName ? (
            <>
              <ListRow
                leading={<RowIcon name="shield-checkmark-outline" />}
                title="实名认证"
                subtitle={
                  security?.realNameVerified
                    ? `已实名${security.realName ? ` · ${maskName(security.realName)}` : ''}`
                    : '未认证（可选，认证后可用于找回账号）'
                }
                onPress={onOpenRealName}
                trailing={<Chevron />}
              />
              <ListSeparator inset={52} />
            </>
          ) : null}
          <ListRow
            leading={<RowIcon name="call-outline" />}
            title="手机号"
            subtitle={maskPhone(security?.phone)}
            onPress={onOpenPhoneChange}
            trailing={<Chevron />}
          />
          {features.emailBinding ? (
            <>
              <ListSeparator inset={52} />
              <ListRow
                leading={<RowIcon name="mail-outline" />}
                title="邮箱"
                subtitle={security?.email ? security.email : '未绑定（用于接收通知与找回账号）'}
                onPress={onOpenEmail}
                trailing={<Chevron />}
              />
            </>
          ) : null}
          <ListSeparator inset={52} />
          <ListRow
            leading={<RowIcon name="key-outline" />}
            title="登录密码"
            subtitle={
              security?.passwordSet
                ? '已设置，可用「手机号 + 密码」登录'
                : '未设置，目前只能用验证码登录'
            }
            onPress={onOpenPassword}
            trailing={<Chevron />}
          />
          <ListSeparator inset={52} />
          <ListRow
            leading={<RowIcon name="trash-outline" tone="danger" />}
            title="账号注销"
            subtitle="删除个人信息并停用账号"
            tone="danger"
            onPress={onOpenDeletion}
            trailing={<Chevron />}
          />
        </ListGroup>
      ) : null}

      {section === 'preferences' ? (
        <ListGroup>
          <ListRow
            leading={<RowIcon name="moon-outline" />}
            title="深色模式"
            subtitle={scheme === 'dark' ? '已开启' : '跟随浅色'}
            trailing={
              <Switch
                value={scheme === 'dark'}
                onValueChange={toggleScheme}
                accessibilityLabel="深色模式"
                trackColor={{ false: theme.color.border, true: theme.color.accent }}
                thumbColor={theme.color.surfaceRaised}
              />
            }
          />
          <ListSeparator inset={52} />
          {/*
            通知卡是「持续通知」；顶部小条是它下面的独立开关，需要用户明确授权悬浮窗。
            它和到点提醒分开，用户只想要总览时可以单开这一项。
          */}
          <ListRow
            leading={<RowIcon name="phone-portrait-outline" />}
            title="任务栏与锁屏显示"
            subtitle={
              taskBarEnabled
                ? '通知栏常驻，锁屏显示最近截止与三色任务条'
                : '已关闭，不在通知栏和锁屏显示任务总览'
            }
            trailing={
              <Switch
                value={taskBarEnabled}
                onValueChange={(next) => {
                  if (!next) {
                    setTaskBarEnabled(false);
                    overlayRequestPending.current = false;
                    setOverlayEnabled(false);
                    void setTaskBarOverlayEnabled(false);
                    void clearTaskBarNotification();
                    return;
                  }
                  void askPermission('notification').then((granted) => {
                    if (!granted) {
                      return;
                    }
                    setTaskBarEnabled(true);
                    void syncTaskBarNotification({ api, enabled: true });
                  });
                }}
                accessibilityLabel="任务栏与锁屏显示"
                trackColor={{ false: theme.color.border, true: theme.color.accent }}
                thumbColor={theme.color.surfaceRaised}
              />
            }
          />
          <ListSeparator inset={52} />
          {Platform.OS === 'android' ? (
            <>
              <ListRow
                leading={<RowIcon name="albums-outline" />}
                title="顶部任务小条"
                subtitle={
                  overlayEnabled
                    ? '状态栏下方常驻三色小条，点一下展开任务'
                    : !taskBarEnabled
                      ? '需先开启上方“任务栏与锁屏显示”'
                      : '开启后需允许“显示在其他应用上层”'
                }
                trailing={
                  <Switch
                    value={overlayEnabled}
                    disabled={overlayBusy || !taskBarEnabled}
                    onValueChange={(next) => {
                      if (!next) {
                        overlayRequestPending.current = false;
                        setOverlayEnabled(false);
                        void setTaskBarOverlayEnabled(false);
                        return;
                      }
                      if (!taskBarEnabled) {
                        Alert.alert(
                          '先开启任务栏与锁屏显示',
                          '顶部小条和通知卡共用同一份任务数据，请先打开上方开关。',
                        );
                        return;
                      }
                      setOverlayBusy(true);
                      void (async () => {
                        try {
                          const granted = await taskBarOverlayPermissionGranted();
                          if (!granted) {
                            overlayRequestPending.current = true;
                            Alert.alert(
                              '需要悬浮窗权限',
                              '顶部小条会显示在状态栏下方，不会挡住 App 内的主要操作。请允许“显示在其他应用上层”后再回来。',
                              [
                                {
                                  text: '暂不开启',
                                  style: 'cancel',
                                  onPress: () => {
                                    overlayRequestPending.current = false;
                                  },
                                },
                                {
                                  text: '去授权',
                                  onPress: () => {
                                    void requestTaskBarOverlayPermission();
                                  },
                                },
                              ],
                            );
                            return;
                          }
                          const started = await setTaskBarOverlayEnabled(true);
                          setOverlayEnabled(started);
                          if (!started) {
                            Alert.alert(
                              '没有开启',
                              '系统没有允许顶部小条运行，请检查“显示在其他应用上层”权限。',
                            );
                          }
                        } finally {
                          setOverlayBusy(false);
                        }
                      })();
                    }}
                    accessibilityLabel="顶部任务小条"
                    trackColor={{ false: theme.color.border, true: theme.color.accent }}
                    thumbColor={theme.color.surfaceRaised}
                  />
                }
              />
              <ListSeparator inset={52} />
            </>
          ) : null}
          {Platform.OS === 'android' && systemCalendarAvailable() ? (
            <>
              <ListRow
                leading={<RowIcon name="calendar-outline" />}
                title="同步到系统日历"
                subtitle={
                  calendarSyncBusy
                    ? '正在把日程写入手机自带日历…'
                    : calendarSyncOn
                      ? '已开启：新建和修改的日程会单向写入手机日历'
                      : '单向导出到手机自带日历，不读取、不修改你原来的日程'
                }
                trailing={
                  <Switch
                    value={calendarSyncOn}
                    disabled={calendarSyncBusy}
                    onValueChange={(next) => {
                      if (calendarSyncBusy) {
                        return;
                      }
                      if (!next) {
                        setCalendarSyncOn(false);
                        void setSystemCalendarEnabled(false);
                        void clearSystemCalendarEvents().then((cleared) => {
                          showToast(
                            cleared
                              ? '已关闭，并移除由时纪流写入的日程'
                              : '已关闭；部分条目未能移除（可能缺少日历权限）',
                          );
                        });
                        return;
                      }
                      setCalendarSyncBusy(true);
                      void (async () => {
                        try {
                          const granted = await askPermission('calendar');
                          if (!granted) {
                            return;
                          }
                          await setSystemCalendarEnabled(true);
                          setCalendarSyncOn(true);
                          const result = await backfillSystemCalendar(api);
                          showToast(`已同步 ${result.exported} 条日程到系统日历`);
                          if (result.failed > 0) {
                            Alert.alert(
                              '部分日程没有同步',
                              `有 ${result.failed} 条写入失败。已同步成功的条目不受影响，之后新建或修改的日程仍会继续写入。`,
                            );
                          }
                        } catch (cause) {
                          await setSystemCalendarEnabled(false);
                          setCalendarSyncOn(false);
                          Alert.alert(
                            '没有开启系统日历同步',
                            userFacingError(cause, '请检查日历权限后重试'),
                          );
                        } finally {
                          setCalendarSyncBusy(false);
                        }
                      })();
                    }}
                    accessibilityLabel="同步到系统日历"
                    trackColor={{ false: theme.color.border, true: theme.color.accent }}
                    thumbColor={theme.color.surfaceRaised}
                  />
                }
              />
              <ListSeparator inset={52} />
            </>
          ) : null}
          {/*
            到点提醒的总开关（spec §4.5）。关掉时不只「以后不排」：已排的本机通知也会被撤掉，
            否则用户关掉之后照样被提醒，那个开关就成了摆设。
          */}
          <ListRow
            leading={<RowIcon name="notifications-outline" />}
            title="到点提醒"
            subtitle={notificationEnabled ? '日程与待办会按时提醒' : '已关闭，到点不会提醒'}
            trailing={
              <Switch
                value={notificationEnabled}
                onValueChange={setNotificationEnabled}
                accessibilityLabel="到点提醒"
                trackColor={{ false: theme.color.border, true: theme.color.accent }}
                thumbColor={theme.color.surfaceRaised}
              />
            }
          />
          <ListSeparator inset={52} />
          {/*
            提醒方式（spec §4.5）：静音 / 消息提醒 / 闹钟。

            **这一份只是「新建日程时的默认档」**——真正的档位按每条日程存在服务端
            （`reminder.sound`，见 V22 迁移），在编辑日程的「提醒」页里改。
            Android 的渠道声音建好之后改不了，所以改档位 = 之后的提醒换一个渠道；
            这里顺便**重排一次**本机排期，
            否则用户改完还要等下次回到前台才生效，看起来就像「改了没用」。
          */}
          <View style={styles.stackedRow}>
            <View style={styles.stackedRowHeader}>
              <RowIcon name="musical-notes-outline" />
              <View style={styles.stackedRowBody}>
                <Text style={[styles.stackedRowTitle, { color: theme.color.textPrimary }]}>
                  默认提醒方式
                </Text>
                <Text style={[styles.stackedRowSubtitle, { color: theme.color.textSecondary }]}>
                  {notificationEnabled
                    ? `${describeReminderSound(reminderSound)}（新建日程 / 待办时用它，可逐条改）`
                    : '到点提醒已关闭，这里的选择会在打开后生效'}
                </Text>
              </View>
            </View>
            <View style={styles.segmentedWrap}>
              <SegmentedControl<ReminderSound>
                label="提醒声音"
                options={[
                  { value: 'silent', label: '静音' },
                  { value: 'default', label: '消息' },
                  { value: 'alarm', label: '闹钟' },
                ]}
                value={reminderSound}
                onChange={(next) => {
                  setReminderSound(next);
                  void refreshLocalReminders({
                    api,
                    scheduler: reminders,
                    enabled: notificationEnabled,
                  });
                }}
              />
            </View>
          </View>
        </ListGroup>
      ) : null}

      {section === 'support' ? (
        <ListGroup>
          {features.feedback ? (
            <>
              <ListRow
                leading={<RowIcon name="chatbubble-ellipses-outline" />}
                title="意见反馈"
                onPress={onOpenFeedback}
                trailing={<Chevron />}
              />
              <ListSeparator inset={52} />
            </>
          ) : null}
          {/*
            手动检查更新（spec §4.1.11）：启动时已静默查过一次，这里是「我就是要现在查」——
            它**一定会给反馈**：有新版本弹更新说明，没有就明确说「已是最新版本」。
          */}
          <ListRow
            leading={<RowIcon name="cloud-download-outline" />}
            title="检查更新"
            subtitle={`当前版本 ${currentVersionName}`}
            onPress={() => void checkUpdate(true)}
            trailing={<Chevron />}
          />
        </ListGroup>
      ) : null}

      {section === 'legal' ? (
        <ListGroup>
          {trainingData ? (
            <>
              <ListRow
                leading={<RowIcon name="sparkles-outline" />}
                title="帮助改进识别（可选）"
                subtitle={
                  trainingData.enabled
                    ? `已同意：仅使用脱敏后的识别文字，最多保留 ${trainingData.retentionDays} 天`
                    : '默认关闭；不上传原图，也不会保留原始识别文字'
                }
                trailing={
                  <Switch
                    value={trainingData.enabled}
                    disabled={trainingBusy}
                    onValueChange={(next) => {
                      setTrainingBusy(true);
                      void api
                        .setTrainingData(next)
                        .then((view) => setTrainingData(view))
                        .catch(() => Alert.alert('保存失败', '请检查网络后重试。'))
                        .finally(() => setTrainingBusy(false));
                    }}
                    accessibilityLabel="帮助改进识别"
                    trackColor={{ false: theme.color.border, true: theme.color.accent }}
                    thumbColor={theme.color.surfaceRaised}
                  />
                }
              />
              <ListSeparator inset={52} />
            </>
          ) : null}
          <ListRow
            leading={<RowIcon name="document-text-outline" />}
            title={LEGAL_DOCS['privacy-policy'].title}
            subtitle="我们收集什么、怎么用、怎么删"
            onPress={() => onOpenLegal('privacy-policy')}
            trailing={<Chevron />}
          />
          <ListSeparator inset={52} />
          <ListRow
            leading={<RowIcon name="reader-outline" />}
            title={LEGAL_DOCS['user-agreement'].title}
            onPress={() => onOpenLegal('user-agreement')}
            trailing={<Chevron />}
          />
          <ListSeparator inset={52} />
          <ListRow
            leading={<RowIcon name="shield-checkmark-outline" />}
            title={LEGAL_DOCS['children-privacy'].title}
            onPress={() => onOpenLegal('children-privacy')}
            trailing={<Chevron />}
          />
          <ListSeparator inset={52} />
          <ListRow
            leading={<RowIcon name="list-outline" />}
            title={LEGAL_DOCS['personal-info-collected'].title}
            onPress={() => onOpenLegal('personal-info-collected')}
            trailing={<Chevron />}
          />
          <ListSeparator inset={52} />
          <ListRow
            leading={<RowIcon name="share-social-outline" />}
            title={LEGAL_DOCS['shared-info-with-third-parties'].title}
            // 接入方变多了（高德 / 短信 / 邮件推送 / 实人认证 / 百炼），这里要跟着走，
            // 否则用户点进去看到的清单与入口描述对不上，等于「声明与实际不符」
            subtitle="高德地图、短信与邮件推送、实人认证、极光推送、通义千问"
            onPress={() => onOpenLegal('shared-info-with-third-parties')}
            trailing={<Chevron />}
          />
        </ListGroup>
      ) : null}

      {section === 'about' ? (
        <ListGroup>
          <ListRow leading={<RowIcon name="business-outline" />} title="运营主体" subtitle={OPERATOR_NAME} />
          <ListSeparator inset={52} />
          {/*
            版本读**真机实际版本**（expo-constants），不再用硬编码常量：
            那个常量手动维护，早就停在 0.0.1 了，用户看到的就是「装了新版还写着旧版本」。
          */}
          <ListRow
            leading={<RowIcon name="information-circle-outline" />}
            title="版本"
            subtitle={currentVersionName}
          />
        </ListGroup>
      ) : null}
      </ScrollView>
    </Screen>
  );
}

/** 实名只露首字：截图 / 旁人一眼扫到全名不合适。 */
function maskName(name: string): string {
  return name.length <= 1 ? name : `${name.charAt(0)}${'*'.repeat(name.length - 1)}`;
}

/** 行首图标：与「我的」页同一套（统一线性图标 + 尺寸 + 颜色）。 */
function RowIcon({ name, tone = 'default' }: { name: string; tone?: 'default' | 'danger' }) {
  const theme = useAppTheme();
  return (
    <View style={styles.rowIcon}>
      <Ionicons
        name={name as never}
        size={20}
        color={tone === 'danger' ? theme.color.danger : theme.color.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** 内边距只给内容：页头必须通栏（和「新建日程」一致） */
  bodyScroll: { flex: 1 },
  /** 底部多留一段滚动余量，最下面的提醒方式不会贴住系统手势条。 */
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 96 },
  rowIcon: { width: 36, alignItems: 'flex-start', justifyContent: 'center' },
  stackedRow: { paddingHorizontal: 16, paddingVertical: 14 },
  stackedRowHeader: { flexDirection: 'row', alignItems: 'center' },
  stackedRowBody: { flex: 1 },
  stackedRowTitle: { fontSize: 16 },
  stackedRowSubtitle: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  /** 三个选项占满整行；不再缩在标题右侧，文字和点击区都不会被挤掉。 */
  segmentedWrap: { marginTop: 12 },
});

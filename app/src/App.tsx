import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createNavigationContainerRef } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  AppProvider,
  useAppSessionState,
  useAppTheme,
  useRuntime,
  useRuntimeState,
} from './context/AppContext';
import { createRuntime } from './runtime';
import { createSecureConsentStore, type ConsentStore } from './auth/consentStore';
import { withTimeout } from './shared/async';
import { migrateLegacyStorage } from './shared/auth';
import { askPermission } from './shared/permission';
import {
  DeviceRecognitionUnavailable,
  EventImportScreen,
  consumeSharedImage,
  discardSharedImage,
  registerBundledOcrEngine,
  recognizeScheduleImage,
  subscribeSharedImages,
  warmUpOcrEngine,
  type DraftEdit,
  type DraftEditTarget,
  type RecognizedDraft,
} from './modules/vision';
import { VoiceInputScreen } from './modules/asr';
import { LegalScreen, PrivacyConsentScreen } from './modules/compliance';
import {
  buildConsentRecord,
  hasAcceptedPolicy,
  type LegalDoc,
} from './modules/compliance/pure';
import {
  OrgAccountsScreen,
  OrgEventEditorScreen,
  OrgRecipientPickerScreen,
  OrgTabScreen,
} from './modules/org';
import Constants from 'expo-constants';
import {
  FeedbackScreen,
  SettingsScreen,
  SettingsSectionScreen,
  type SettingsSectionKey,
} from './modules/ops';
import {
  AccountDeletionScreen,
  AvatarCropScreen,
  EmailBindScreen,
  LoginScreen,
  PasswordResetScreen,
  PasswordScreen,
  PhoneChangeScreen,
  ProfileEditScreen,
  RealNameScreen,
  RegisterScreen,
} from './modules/identity';
import {
  TaskEditorScreen,
  TasksScreen,
  clearTaskBarNotification,
  flushPendingTaskBarCompletions,
  restoreTaskBarOverlay,
  subscribeNativeTaskBarCompletion,
  syncTaskBarNotification,
  taskDraftFromSwitch,
  type TaskDraft,
} from './modules/tasks';
import {
  AgendaScreen,
  EventEditorScreen,
  ensureSystemCalendarTaskBackfill,
  LocationPickerScreen,
  RecurrencePickerScreen,
  ReminderPickerScreen,
  type PlaceSelection,
  type ReminderSelection,
} from './modules/calendar';
import {
  APP_TIMEZONE,
  eventDraftFromSwitch,
  localDateKey,
  type EventDraft,
  type Recurrence,
} from './modules/calendar/pure';
import type { OrgEvent } from './shared/api';
import {
  AppUpdateProvider,
  DEFAULT_REMINDER_SOUND,
  actionKindFor,
  refreshLocalReminders,
  subscribeNotificationResponses,
  type NotificationRoute,
  type ReminderSound,
} from './modules/notifications';
import { ToastHost } from './shared/ui';

const STARTUP_CONSENT_TIMEOUT_MS = 3_000;
const STARTUP_RUNTIME_TIMEOUT_MS = 12_000;
const STARTUP_SESSION_TIMEOUT_MS = 4_000;

type AuthStackParamList = {
  Login: undefined;
  /** 注册账号：手机号 + 验证码 + 自设密码 */
  Register: undefined;
  /** 忘记密码：短信验证码验证后重设新密码（未登录状态） */
  PasswordReset: undefined;
  /** 登录页要能点开《用户服务协议》《隐私政策》原文（规范 §四） */
  Legal: { doc: LegalDoc };
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator();

/**
 * 底部导航图标。用线性图标 + 选中态实心，符合黑白极简的设计语言（spec §7.6.5）。
 *
 * 之前没配图标时 React Navigation 会渲染缺字体的占位符，看起来就是「乱码方块」。
 */
const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Agenda: { active: 'calendar', inactive: 'calendar-outline' },
  Tasks: { active: 'checkbox', inactive: 'checkbox-outline' },
  OrgEvents: { active: 'business', inactive: 'business-outline' },
  Settings: { active: 'person', inactive: 'person-outline' },
};

function tabIcon(routeName: keyof typeof TAB_ICONS) {
  return ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <Ionicons
      name={(focused ? TAB_ICONS[routeName].active : TAB_ICONS[routeName].inactive) as never}
      size={size}
      color={color}
    />
  );
}

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      {/* 只登录个人账号（spec §3.2）：组织账号在组织 tab 的「账户管理」里认领 */}
      <AuthStack.Screen name="Login">
        {({ navigation }) => (
          <LoginScreen
            onOpenLegal={(doc) => navigation.navigate('Legal', { doc })}
            onOpenPasswordReset={() => navigation.navigate('PasswordReset')}
            onOpenRegister={() => navigation.navigate('Register')}
          />
        )}
      </AuthStack.Screen>
      <AuthStack.Screen name="PasswordReset">
        {({ navigation }) => <PasswordResetScreen onBack={() => navigation.goBack()} />}
      </AuthStack.Screen>
      <AuthStack.Screen name="Register">
        {({ navigation }) => (
          <RegisterScreen
            onBack={() => navigation.goBack()}
            onOpenLegal={(doc) => navigation.navigate('Legal', { doc })}
          />
        )}
      </AuthStack.Screen>
      <AuthStack.Screen name="Legal">
        {({ navigation, route }) => (
          <LegalScreen doc={route.params.doc} onBack={() => navigation.goBack()} />
        )}
      </AuthStack.Screen>
    </AuthStack.Navigator>
  );
}

type MainTabsProps = {
  onCreateEvent: (dateKey: string) => void;
  onOpenEvent: (eventId: number, dateKey: string, occurrenceDate: string | null) => void;
  onCreateTask: () => void;
  onOpenTask: (taskId: number) => void;
  onOpenOrgAccounts: () => void;
  /** 图片识别出来一批日程草稿：进确认页让用户补日期 / 改标题，再一键添加（spec §4.1.9） */
  onReviewDrafts: (drafts: RecognizedDraft[]) => void;
  /** 语音输入：进「按住说话」页面（spec §4.1.9.1） */
  onVoiceInput: () => void;
  /** 组织管理员在手机上新建并下发组织日程（spec §4.2.2） */
  onCreateOrgEvent: (dateKey: string) => void;
  /** 编辑自己下发的组织日程（spec §4.2.2：只有发起人能改） */
  onEditOrgEvent: (event: OrgEvent) => void;
  onOpenOrgEvent: (identityId: number, dateKey: string) => void;
  /** 改名字（昵称，spec §4.1.8）：昵称可改，服务端是 PATCH /me */
  onOpenProfileEdit: () => void;
  /** 打开「我的」里某一类设置的独立子页 */
  onOpenSection: (section: SettingsSectionKey) => void;
  /** 选好头像原图后进取景页（正方框 + 拖动缩放，spec §4.1.8） */
  onOpenAvatarCrop: (uri: string) => void;
  /** 取景页裁完回传的本地图片（version 变了才处理） */
  avatarCrop: { version: number; uri: string | null };
  /** 日程保存后让日历定位到对应日期；version 变了才处理 */
  agendaFocus: { version: number; dateKey: string | null };
};

function MainTabs({
  onCreateEvent,
  onOpenEvent,
  onCreateTask,
  onOpenTask,
  onOpenOrgAccounts,
  onCreateOrgEvent,
  onEditOrgEvent,
  onOpenOrgEvent,
  onReviewDrafts,
  onVoiceInput,
  onOpenProfileEdit,
  onOpenSection,
  onOpenAvatarCrop,
  avatarCrop,
  agendaFocus,
}: MainTabsProps) {
  const theme = useAppTheme();
  const { session } = useAppSessionState();

  return (
    <Tabs.Navigator
      /**
       * 用身份 ID 做 key：切换身份时整棵 tab 树重建。
       *
       * 否则切回个人身份后，「组织」tab 虽然从列表里消失，但它**已经加载的数据**会留在内存里，
       * 用户会看到"个人身份下还能看到组织日程"——数据没错，是界面状态没跟着身份走。
       */
      key={session?.identityId ?? 'anonymous'}
      screenOptions={{
        headerShown: false,
        /**
         * 键盘弹起时收起 tab 栏：小安的输入框在页面最底部，留着 tab 栏会跟键盘
         * 争同一块空间（要么输入框顶着 tab 栏、要么 tab 栏浮在键盘上）。
         * 微信、豆包在聊天页也都是键盘一出来就把底栏收掉。
         */
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.color.accent,
        tabBarInactiveTintColor: theme.color.textTertiary,
        tabBarStyle: { backgroundColor: theme.color.surfaceRaised, borderTopColor: theme.color.border },
      }}
    >
      <Tabs.Screen name="Agenda" options={{ title: '日历', tabBarIcon: tabIcon('Agenda') }}>
        {() => (
          <AgendaScreen
            onCreateEvent={onCreateEvent}
            onOpenEvent={onOpenEvent}
            // 日历页的检索会跨到待办，所以这里也要能直接打开待办编辑页（spec §4.1.7）
            onOpenTask={onOpenTask}
            onOpenOrgEvent={onOpenOrgEvent}
            // 图片识别出草稿后进确认页（spec §4.1.9）
            onReviewDrafts={onReviewDrafts}
            // 语音输入（spec §4.1.9.1）：按住说话 → 转写 → 同一条确认页
            onVoiceInput={onVoiceInput}
            agendaFocus={agendaFocus}
          />
        )}
      </Tabs.Screen>
      <Tabs.Screen name="Tasks" options={{ title: '待办', tabBarIcon: tabIcon('Tasks') }}>
        {() => (
          <TasksScreen
            onCreateTask={onCreateTask}
            onOpenTask={onOpenTask}
            onOpenEvent={onOpenEvent}
          />
        )}
      </Tabs.Screen>
      {/*
        组织 tab **常驻**（spec §4.2.3）：没有绑定组织账号时展示空状态与添加入口。
        入口消失会让用户根本找不到「我在哪里加组织账号」。
      */}
      <Tabs.Screen name="OrgEvents" options={{ title: '组织', tabBarIcon: tabIcon('OrgEvents') }}>
        {() => (
          <OrgTabScreen
            onOpenAccounts={onOpenOrgAccounts}
            onCreateOrgEvent={onCreateOrgEvent}
            onEditOrgEvent={onEditOrgEvent}
          />
        )}
      </Tabs.Screen>
      <Tabs.Screen name="Settings" options={{ title: '我的', tabBarIcon: tabIcon('Settings') }}>
        {() => (
          <SettingsScreen
            onOpenProfileEdit={onOpenProfileEdit}
            onOpenSection={onOpenSection}
            onOpenAvatarCrop={onOpenAvatarCrop}
            avatarCrop={avatarCrop}
          />
        )}
      </Tabs.Screen>
    </Tabs.Navigator>
  );
}

type AppStackParamList = {
  /** 深链 / 通知点进来时可以指定先落到哪个 tab（任务总览图标 → 待办） */
  Main: { screen?: 'Agenda' | 'Tasks' | 'OrgEvents' | 'Settings' } | undefined;
  /** 语音输入：按住说话 → 转写 → 解析成日程（spec §4.1.9.1） */
  VoiceInput: undefined;
  EventEditor: {
    dateKey: string;
    eventId?: number;
    occurrenceDate?: string | null;
    /** 从「待办」切回来时预填的新建草稿 */
    initialDraft?: EventDraft;
    initialReminderSound?: ReminderSound;
  };
  /** 图片识别出的日程草稿 → 确认页（补日期 / 改标题 / 一键添加，spec §4.1.9） */
  EventImport: { drafts: RecognizedDraft[] };
  /** 确认页里点开的某一条草稿 → 整页编辑器（草稿模式，改完回传、不落库） */
  EventDraftEditor: { draft: EventDraft; dateKey: string };
  /** 确认页里点开的待办草稿 → 待办编辑器（草稿模式，改完回传、不落库） */
  TaskDraftEditor: { draft: TaskDraft };
  TaskEditor: {
    taskId?: number;
    /** 从「日程」切过来时预填的新建草稿 */
    initialDraft?: TaskDraft;
    initialReminderSound?: ReminderSound;
  };
  OrgEventEditor: { dateKey: string; event?: OrgEvent };
  OrgRecipientPicker: undefined;
  LocationPicker: undefined;
  RecurrencePicker: { startDateKey: string; initial: Recurrence };
  ReminderPicker: { initial: { minutes: number[]; sound: ReminderSound } };
  Feedback: undefined;
  OrgAccounts: undefined;
  /** 改名字（昵称）：二级页而不是弹窗，键盘与校验都在同一套页面结构里（spec §4.1.8） */
  ProfileEdit: undefined;
  SettingsSection: { section: SettingsSectionKey };
  RealName: undefined;
  EmailBind: undefined;
  PhoneChange: undefined;
  /** 「账号与安全」里设置 / 修改登录密码 */
  Password: undefined;
  /** 头像取景：正方框 + 拖动缩放，确认后按框裁成 1:1（spec §4.1.8） */
  AvatarCrop: { uri: string };
  Legal: { doc: LegalDoc };
  AccountDeletion: undefined;
};

const AppStack = createNativeStackNavigator<AppStackParamList>();

/**
 * 通知点击后的跳转走这个 ref 而不是 `useNavigation`：
 * 监听通知的组件不在任何 Screen 里（它在整棵导航树之外），拿不到 navigation 对象。
 */
const navigationRef = createNavigationContainerRef<AppStackParamList>();

/** 回到前台时重排本地提醒的最小间隔：切来切去不该每次都打一次接口。 */
const REMINDER_RESYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 登录后的导航：Tab（日历 / 待办 / 组织 / 我的）+ 若干独立编辑页。
 *
 * 编辑页做成栈里的整页而不是弹窗（spec §4.1.5）：字段量已到系统日历级别，
 * 而且地点搜索需要自己的二级页面与返回栈。
 *
 * 地点选完要回传给编辑页，而它既要在跳转期间存活、又要能被「不设地点」显式置空，
 * 因此由本组件持有，用 version 表达「又选了一次」。
 */
function MainStack() {
  const [placeSelection, setPlaceSelection] = useState<PlaceSelection>({ version: 0, place: null });
  // 重复规则 / 提醒的回传，和其他二级页一样用 version 表达「又选了一次」
  const [recurrenceSelection, setRecurrenceSelection] = useState<{
    version: number;
    recurrence: Recurrence | null;
  }>({ version: 0, recurrence: null });
  const [reminderSelection, setReminderSelection] = useState<ReminderSelection>({
    version: 0,
    minutes: [],
    sound: DEFAULT_REMINDER_SOUND,
  });
  /** 头像取景页裁好的本地图片；version 表达「又裁了一张」，与其它二级页回传同一套语义 */
  const [avatarCrop, setAvatarCrop] = useState<{ version: number; uri: string | null }>({
    version: 0,
    uri: null,
  });
  /** 保存日程后让日历回到那一天；用 version 表达「又保存了一次」 */
  const [agendaFocus, setAgendaFocus] = useState<{ version: number; dateKey: string | null }>({
    version: 0,
    dateKey: null,
  });

  /**
   * 任务总览通知卡左上角的时纪流图标：点它才打开 App，并直接落到「待办」。
   * 卡片其它区域不绑打开动作；这里只消费图标带过来的 chronoflow://tasks。
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const openTasks = (url: string | null) => {
      if (cancelled || !url || !url.startsWith('chronoflow://tasks')) {
        return;
      }
      let attempts = 0;
      const tryNavigate = () => {
        if (cancelled) {
          return;
        }
        if (navigationRef.isReady()) {
          navigationRef.navigate('Main', { screen: 'Tasks' });
          return;
        }
        if (attempts < 20) {
          attempts += 1;
          timer = setTimeout(tryNavigate, 150);
        }
      };
      tryNavigate();
    };
    void Linking.getInitialURL()
      .then(openTasks)
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', (event) => openTasks(event.url));
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
  }, []);
  /**
   * 确认页点开某条草稿 → 编辑器保存后的回传。
   *
   * 与地点 / 重复 / 提醒同一套「version 变了才算改过」的语义：编辑器是栈里的整页，
   * 确认页一直在下面活着，靠这份回传把改好的草稿写回对应的那一行。
   */
  const [draftEdit, setDraftEdit] = useState<DraftEdit | null>(null);
  /** 正在编辑哪一行草稿（编辑器保存时要用它把结果对上号） */
  const [editingImportKey, setEditingImportKey] = useState('');
  /**
   * 组织日程的「下发对象」：选人页挑好后回填。
   *
   * 编辑页和识别确认页共用这一份选择（同一时刻只有一个选人流程在跑），
   * 用 version 表达「又选了一次」，这样从选人页回来一定能刷新界面。
   */
  const [recipients, setRecipients] = useState<{ version: number; memberIds: number[] }>({
    version: 0,
    memberIds: [],
  });
  const today = useMemo(() => localDateKey(new Date().toISOString(), APP_TIMEZONE), []);
  const {
    setActiveOrgIdentityId,
    setOrgFocusDateKey,
    notificationEnabled,
    taskBarEnabled,
    setTaskBarEnabled,
  } = useAppSessionState();
  const { api, reminders } = useRuntime();
  const calendarTaskBackfillStarted = useRef(false);
  const theme = useAppTheme();
  const [shareRecognizing, setShareRecognizing] = useState(false);
  const [pendingSharedDrafts, setPendingSharedDrafts] = useState<RecognizedDraft[] | null>(null);
  const sharedImportBusyRef = useRef(false);

  useEffect(() => {
    if (calendarTaskBackfillStarted.current) {
      return;
    }
    calendarTaskBackfillStarted.current = true;
    void ensureSystemCalendarTaskBackfill(api);
  }, [api]);

  const importSharedImage = useCallback(async (uri: string) => {
    if (sharedImportBusyRef.current) {
      return;
    }
    sharedImportBusyRef.current = true;
    setShareRecognizing(true);
    try {
      const result = await recognizeScheduleImage({ uri, api, today });
      if (result.status === 'no-text') {
        Alert.alert('没识别出文字', '这张截图里没有识别出可用的文字，换一张再试。');
        return;
      }
      if (result.status === 'no-drafts') {
        Alert.alert('没找到要做的事', '这张截图里没有找到要做的事。');
        return;
      }
      setPendingSharedDrafts(result.drafts);
    } catch (cause) {
      if (cause instanceof DeviceRecognitionUnavailable) {
        Alert.alert(
          '端侧识别还没就绪',
          `${cause.message}\n\n识别全程在手机本地完成，不会把图片上传到服务器。`,
        );
      } else {
        Alert.alert('截图识别失败', '这张图没有识别成功，请稍后重试。');
      }
    } finally {
      discardSharedImage(uri);
      sharedImportBusyRef.current = false;
      setShareRecognizing(false);
    }
  }, [api, today]);

  const consumeSharedImageIfAny = useCallback(async () => {
    if (sharedImportBusyRef.current) {
      return;
    }
    try {
      const shared = await consumeSharedImage();
      if (!shared) {
        return;
      }
      if (shared.error) {
        Alert.alert('截图导入失败', shared.error);
        return;
      }
      if (shared.uri) {
        await importSharedImage(shared.uri);
      }
    } catch {
      Alert.alert('截图导入失败', '没有读到这张图片，请重新分享一次。');
    }
  }, [importSharedImage]);

  /** 系统分享图片进来：冷启动主动取一次，运行中由原生事件 / 回前台再取。 */
  useEffect(() => {
    let cancelled = false;
    const consume = () => {
      if (!cancelled) {
        void consumeSharedImageIfAny();
      }
    };
    consume();
    const offShare = subscribeSharedImages(consume);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        consume();
      }
    });
    return () => {
      cancelled = true;
      offShare();
      subscription.remove();
    };
  }, [consumeSharedImageIfAny]);

  /** 识别出草稿后再跳确认页：首次启动时导航树可能还没 ready，最多等 3 秒。 */
  useEffect(() => {
    if (!pendingSharedDrafts) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (cancelled) {
        return;
      }
      if (navigationRef.isReady()) {
        navigationRef.navigate('EventImport', { drafts: pendingSharedDrafts });
        setPendingSharedDrafts(null);
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        timer = setTimeout(open, 150);
      }
    };
    open();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [pendingSharedDrafts]);

  /**
   * 注册端侧 OCR 引擎（spec §4.1.9）。
   *
   * <p>「上传图片 → 识别日程」的第一段是手机本地的 OCR（图片不出手机），它是原生模块：
   * 这里只注册一个**代理**，实现要等第一次真的识别时才加载（启动路径上不碰原生模块，
   * 免得原生库有问题就让整个 App 打不开）。**Expo Go 里拿不到模块**时，
   * 界面会如实说「端侧识别需要开发版构建」，而不是静默失败或偷偷改成上传图片到服务器。
   * 第二段（文字 → 日程草稿）在服务端做。
   */
  useEffect(() => {
    registerBundledOcrEngine();
    /*
     * 端侧 OCR 自检开关（**默认关**，出包时用环境变量打开）：
     *
     *   EXPO_PUBLIC_OCR_SELF_TEST=1 bash scripts/build_apk.sh --release ...
     *
     * 打开后启动就把引擎（下载模型 + 建 ONNX session）跑一遍并打日志——OCR 那条链路在
     * 「登录后的日历页」，而真机上的问题（例如点上传图片闪退）恰恰只在这条链路上出现，
     * 模拟器上又没法登录，所以需要一个不依赖登录的复现入口。
     */
    if (process.env.EXPO_PUBLIC_OCR_SELF_TEST === '1' || Constants.expoConfig?.extra?.ocrSelfTest === true) {
      void warmUpOcrEngine().then(
        () => console.log('[vision] OCR 自检：引擎加载流程结束'),
        (cause) => console.log(`[vision] OCR 自检异常：${String(cause)}`),
      );
    }
  }, []);

  /**
   * 本机提醒的定期重排（spec §4.5）。
   *
   * 只排一次不够：重复日程只排得出最近的若干次、别的设备改了提醒、用户把通知开关关掉
   * —— 这些都不会体现在本机的排期里。冷启动 + 回到前台各对齐一次，把差异收掉。
   */
  useEffect(() => {
    let lastRun = 0;
    const run = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastRun < REMINDER_RESYNC_INTERVAL_MS) {
        return;
      }
      lastRun = now;
      void refreshLocalReminders({ api, scheduler: reminders, enabled: notificationEnabled });
    };
    run(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        run(false);
      }
    });
    return () => subscription.remove();
  }, [api, reminders, notificationEnabled]);

  /**
   * 通知栏 / 锁屏常驻任务总览。
   *
   * 首次启动先用自己的文案说明用途，再申请系统通知权限；用户拒绝就如实关掉开关，
   * 不反复弹窗。之后冷启动、回到前台、以及任务页/日历页完成任务时都会同步内容。
   * 通知本身是普通持续通知；顶部小条只有用户单独授权并开启后才恢复。
   */
  useEffect(() => {
    let cancelled = false;
    let lastRun = 0;
    if (!taskBarEnabled) {
      void clearTaskBarNotification();
      return () => {
        cancelled = true;
      };
    }

    const refresh = async (requestPermission: boolean) => {
      if (cancelled) {
        return;
      }
      const granted = await askPermission(
        'notification',
        requestPermission ? {} : { quiet: true },
      );
      if (cancelled) {
        return;
      }
      if (!granted) {
        if (requestPermission) {
          setTaskBarEnabled(false);
        }
        await clearTaskBarNotification();
        return;
      }
      await syncTaskBarNotification({ api, enabled: true });
      await restoreTaskBarOverlay();
    };

    lastRun = Date.now();
    void refresh(true);
    const subscription = AppState.addEventListener('change', (state) => {
      const now = Date.now();
      if (state === 'active' && now - lastRun >= REMINDER_RESYNC_INTERVAL_MS) {
        lastRun = now;
        void refresh(false);
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
      // 注意：这里**不能**清通知。App 被从最近任务划掉、Activity 销毁时也会走到
      // 这个 cleanup；清了就会出现「划掉后台，任务条变 0 项、通知卡消失」。
      // 真正的退出登录在 AppContext.signOut 里清理，隐私不会留在锁屏上。
    };
  }, [api, setTaskBarEnabled, taskBarEnabled]);

  /**
   * 锁屏 / 通知栏里点掉的条目先记在原生本地队列里；App 启动和回到前台时补同步服务端。
   * 成功的条目会触发页面重新拉取，失败的留到下一次，不会出现「锁屏勾了、App 里还在」。
   */
  useEffect(() => {
    let cancelled = false;
    const flush = () => {
      if (!cancelled) {
        void flushPendingTaskBarCompletions(api);
      }
    };
    flush();
    const offNative = subscribeNativeTaskBarCompletion(flush);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        flush();
      }
    });
    return () => {
      cancelled = true;
      offNative();
      subscription.remove();
    };
  }, [api]);

  /**
   * 点通知进 App：跳到对应的编辑页（spec §4.5）。
   *
   * 冷启动的那一次点击由 `subscribeNotificationResponses` 补捞；未登录时这棵树还没挂上，
   * 登录后本函数会重新订阅，所以待处理的点击不会丢。
   */
  const [pendingRoute, setPendingRoute] = useState<NotificationRoute | null>(null);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void subscribeNotificationResponses((tap) => {
      if (cancelled) {
        return;
      }
      const action = actionKindFor(tap.actionIdentifier, tap.route.kind);
      if (action === 'OPEN') {
        setPendingRoute(tap.route);
        return;
      }
      if (action === 'SNOOZE') {
        void reminders
          .snooze({
            targetType: tap.route.kind,
            targetId: tap.route.kind === 'EVENT' ? tap.route.eventId : tap.route.taskId,
            title: tap.title ?? '日程提醒',
            body: tap.body ?? tap.title ?? '该处理这件事了',
            sound: tap.sound,
            data: tap.data,
          })
          .then((result) => {
            if (result.permissionDenied) {
              Alert.alert('通知权限未开启', '请在系统设置中允许通知后，再使用“稍后提醒”。');
            } else if (result.failed) {
              Alert.alert('稍后提醒未设置成功', '请打开 App 后重试。');
            }
          });
        return;
      }
      if (action === 'COMPLETE' && tap.route.kind === 'TASK') {
        const taskId = tap.route.taskId;
        void api
          .completeTask(taskId, true)
          .then(
            () => {
              void reminders.cancel('TASK', taskId).catch(() => undefined);
            },
            () => {
              Alert.alert('完成失败', '请打开待办后手动标记完成。');
            },
          );
      }
    })
      .then((off) => {
        dispose = off;
      })
      .catch(() => {
        // 没有通知模块（Web 预览）：忽略，不影响其它功能
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [api, reminders]);

  useEffect(() => {
    if (!pendingRoute || !navigationRef.isReady()) {
      return;
    }
    if (pendingRoute.kind === 'EVENT') {
      // 与从列表进编辑页一样：先清掉二级页的回传，避免上一条日程的选择串进来
      setPlaceSelection({ version: 0, place: null });
      setRecurrenceSelection({ version: 0, recurrence: null });
      setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
      navigationRef.navigate('EventEditor', {
        dateKey: pendingRoute.occurrenceDate ?? today,
        eventId: pendingRoute.eventId,
        occurrenceDate: pendingRoute.occurrenceDate,
      });
    } else {
      setPlaceSelection({ version: 0, place: null });
      setRecurrenceSelection({ version: 0, recurrence: null });
      setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
      navigationRef.navigate('TaskEditor', { taskId: pendingRoute.taskId });
    }
    setPendingRoute(null);
  }, [pendingRoute, today]);

  return (
    <>
      <AppStack.Navigator screenOptions={{ headerShown: false }}>
      <AppStack.Screen name="Main">
        {({ navigation }) => (
          <MainTabs
            onCreateEvent={(dateKey) => {
              // 每次从列表进编辑页都重置二级页的回传，避免上一次的选择串到下一次
              setPlaceSelection({ version: 0, place: null });
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              navigation.navigate('EventEditor', { dateKey });
            }}
            onOpenEvent={(eventId, dateKey, occurrenceDate) => {
              // 编辑已有日程同样要重置地点；否则会把上一次「新建」时选的地点带进来
              setPlaceSelection({ version: 0, place: null });
              // 重复 / 提醒也一样：编辑页自己会把已有值拉回来预填
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              navigation.navigate('EventEditor', { dateKey, eventId, occurrenceDate });
            }}
            onCreateTask={() => {
              setPlaceSelection({ version: 0, place: null });
              // 待办编辑页也复用「重复 / 提醒」两个二级页，同样要重置回传
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              navigation.navigate('TaskEditor');
            }}
            onOpenTask={(taskId) => {
              setPlaceSelection({ version: 0, place: null });
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              navigation.navigate('TaskEditor', { taskId });
            }}
            onReviewDrafts={(drafts) => navigation.navigate('EventImport', { drafts })}
            onVoiceInput={() => navigation.navigate('VoiceInput')}
            agendaFocus={agendaFocus}
            onOpenOrgAccounts={() => navigation.navigate('OrgAccounts')}
            onCreateOrgEvent={(dateKey) => navigation.navigate('OrgEventEditor', { dateKey })}
            onEditOrgEvent={(event) =>
              navigation.navigate('OrgEventEditor', {
                dateKey: localDateKey(event.at, APP_TIMEZONE),
                event,
              })
            }
            // 检索命中的组织日程：切到那个组织、定位到那天、跳到组织 tab
            onOpenOrgEvent={(identityId, dateKey) => {
              setActiveOrgIdentityId(identityId);
              setOrgFocusDateKey(dateKey);
              navigation.navigate('Main', { screen: 'OrgEvents' });
            }}
            onOpenProfileEdit={() => navigation.navigate('ProfileEdit')}
            onOpenSection={(section) => navigation.navigate('SettingsSection', { section })}
            onOpenAvatarCrop={(uri) => navigation.navigate('AvatarCrop', { uri })}
            avatarCrop={avatarCrop}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="Legal">
        {({ navigation, route }) => (
          <LegalScreen doc={route.params.doc} onBack={() => navigation.goBack()} />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="AccountDeletion">
        {({ navigation }) => (
          <AccountDeletionScreen
            onBack={() => navigation.goBack()}
            // 注销页里也要能翻到隐私政策原文（它引用了第七章的注销条款）
            onOpenLegal={(doc) => navigation.navigate('Legal', { doc })}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="EventEditor">
        {({ navigation, route }) => (
          <EventEditorScreen
            dateKey={route.params.dateKey}
            eventId={route.params.eventId}
            occurrenceDate={route.params.occurrenceDate ?? null}
            initialDraft={route.params.initialDraft}
            initialReminderSound={route.params.initialReminderSound}
            showKindSwitch={route.params.eventId === undefined && route.params.occurrenceDate == null}
            placeSelection={placeSelection}
            recurrenceSelection={recurrenceSelection}
            reminderSelection={reminderSelection}
            onPickLocation={() => {
              navigation.navigate('LocationPicker');
            }}
            // 把「当前值」当参数传给二级页：编辑页才知道自己这份草稿是什么
            onPickRecurrence={(current, startDateKey) =>
              navigation.navigate('RecurrencePicker', { startDateKey, initial: current })
            }
            onPickReminder={(current) => navigation.navigate('ReminderPicker', { initial: current })}
            onSwitchToTask={(snapshot) => {
              setPlaceSelection({ version: 0, place: null });
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              navigation.replace('TaskEditor', {
                initialDraft: taskDraftFromSwitch(snapshot),
                initialReminderSound: snapshot.reminderSound,
              });
            }}
            onCancel={() => navigation.goBack()}
            onSaved={(dateKey) => {
              if (dateKey) {
                setAgendaFocus((current) => ({ version: current.version + 1, dateKey }));
              }
              navigation.goBack();
            }}
          />
        )}
      </AppStack.Screen>

      {/* 语音输入：按住说话 → 转写 → 解析 → 与拍照识别共用的确认页（spec §4.1.9.1） */}
      <AppStack.Screen name="VoiceInput">
        {({ navigation }) => (
          <VoiceInputScreen
            onCancel={() => navigation.goBack()}
            // replace：从确认页返回时回到日历，而不是又回到录音页
            onReviewDrafts={(drafts) => navigation.replace('EventImport', { drafts })}
          />
        )}
      </AppStack.Screen>

      {/* 语音输入：按住说话 → 转写 → 解析 → 与拍照识别共用的确认页（spec §4.1.9.1） */}
      <AppStack.Screen name="VoiceInput">
        {({ navigation }) => (
          <VoiceInputScreen
            onCancel={() => navigation.goBack()}
            // replace：从确认页返回时回到日历，而不是又回到录音页
            onReviewDrafts={(drafts) => navigation.replace('EventImport', { drafts })}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="EventImport">
        {({ navigation, route }) => (
          <EventImportScreen
            drafts={route.params.drafts}
            draftEdit={draftEdit}
            onEditDraft={(key, target: DraftEditTarget) => {
              // 进草稿编辑器前清掉二级页的回传，避免上一次选的地点 / 重复 / 提醒串进来
              setPlaceSelection({ version: 0, place: null });
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              setEditingImportKey(key);
              if (target.kind === 'EVENT') {
                navigation.navigate('EventDraftEditor', {
                  draft: target.draft,
                  dateKey: target.dateKey ?? today,
                });
              } else {
                navigation.navigate('TaskDraftEditor', { draft: target.draft });
              }
            }}
            onCancel={() => navigation.goBack()}
            // 全部添加成功 → 回日历；日历页的 useFocusEffect 会自动重新拉取，新建的日程立刻可见
            onAdded={() => navigation.navigate('Main', { screen: 'Agenda' })}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="EventDraftEditor">
        {({ navigation, route }) => (
          <EventEditorScreen
            // 草稿模式：用识别出来的草稿起步，保存只回传给确认页，不写服务端
            dateKey={route.params.dateKey}
            initialDraft={route.params.draft}
            placeSelection={placeSelection}
            recurrenceSelection={recurrenceSelection}
            reminderSelection={reminderSelection}
            onPickLocation={() => navigation.navigate('LocationPicker')}
            onPickRecurrence={(current, startDateKey) =>
              navigation.navigate('RecurrencePicker', { startDateKey, initial: current })
            }
            onPickReminder={(current) => navigation.navigate('ReminderPicker', { initial: current })}
            onDraftSaved={(draft, dateKey) => {
              setDraftEdit((current) => ({
                version: (current?.version ?? 0) + 1,
                key: editingImportKey,
                kind: 'EVENT',
                draft,
                dateKey,
              }));
              navigation.goBack();
            }}
            onCancel={() => navigation.goBack()}
            onSaved={() => navigation.goBack()}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="TaskDraftEditor">
        {({ navigation, route }) => (
          <TaskEditorScreen
            todayKey={today}
            initialDraft={route.params.draft}
            showKindSwitch={false}
            placeSelection={placeSelection}
            recurrenceSelection={recurrenceSelection}
            reminderSelection={reminderSelection}
            onPickLocation={() => navigation.navigate('LocationPicker')}
            onPickRecurrence={(current, startDateKey) =>
              navigation.navigate('RecurrencePicker', { startDateKey, initial: current })
            }
            onPickReminder={(current) => navigation.navigate('ReminderPicker', { initial: current })}
            onDraftSaved={(draft) => {
              setDraftEdit((current) => ({
                version: (current?.version ?? 0) + 1,
                key: editingImportKey,
                kind: 'TASK',
                draft,
              }));
              navigation.goBack();
            }}
            onCancel={() => navigation.goBack()}
            onSaved={() => navigation.goBack()}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="TaskEditor">
        {({ navigation, route }) => (
          <TaskEditorScreen
            todayKey={today}
            taskId={route.params?.taskId}
            initialDraft={route.params?.initialDraft}
            initialReminderSound={route.params?.initialReminderSound}
            showKindSwitch={route.params?.taskId === undefined}
            placeSelection={placeSelection}
            recurrenceSelection={recurrenceSelection}
            reminderSelection={reminderSelection}
            onPickLocation={() => navigation.navigate('LocationPicker')}
            onPickRecurrence={(current, startDateKey) =>
              navigation.navigate('RecurrencePicker', { startDateKey, initial: current })
            }
            onPickReminder={(current) => navigation.navigate('ReminderPicker', { initial: current })}
            onSwitchToEvent={(snapshot) => {
              setPlaceSelection({ version: 0, place: null });
              setRecurrenceSelection({ version: 0, recurrence: null });
              setReminderSelection({ version: 0, minutes: [], sound: DEFAULT_REMINDER_SOUND });
              navigation.replace('EventEditor', {
                dateKey: snapshot.hasDue ? snapshot.dateKey : today,
                initialDraft: eventDraftFromSwitch(snapshot),
                initialReminderSound: snapshot.reminderSound,
              });
            }}
            onCancel={() => navigation.goBack()}
            onSaved={() => navigation.goBack()}
          />
        )}
      </AppStack.Screen>

      {/* 新建组织日程：与个人日程编辑页一样是整页（spec §4.1.5 / §4.2.2） */}
      <AppStack.Screen name="OrgEventEditor">
        {({ navigation, route }) => (
          <OrgEventEditorScreen
            dateKey={route.params.dateKey}
            event={route.params.event}
            selectedMemberIds={recipients.memberIds}
            onPickRecipients={() => navigation.navigate('OrgRecipientPicker')}
            onCancel={() => navigation.goBack()}
            onSaved={(summary) =>
              Alert.alert('已下发', summary, [{ text: '好', onPress: () => navigation.goBack() }])
            }
          />
        )}
      </AppStack.Screen>

      {/* 选择下发对象：单独一页（按组织单位分组 + 搜索 + 整组全选 + 顶部已选列表） */}
      <AppStack.Screen name="OrgRecipientPicker">
        {({ navigation }) => (
          <OrgRecipientPickerScreen
            initialSelected={recipients.memberIds}
            onCancel={() => navigation.goBack()}
            onConfirm={(memberIds) => {
              setRecipients((current) => ({ version: current.version + 1, memberIds }));
              navigation.goBack();
            }}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="LocationPicker">
        {({ navigation }) => (
          <LocationPickerScreen
            initialLatitude={placeSelection.place?.latitude ?? null}
            initialLongitude={placeSelection.place?.longitude ?? null}
            onCancel={() => navigation.goBack()}
            onPick={(place) => {
              setPlaceSelection((current) => ({ version: current.version + 1, place }));
              navigation.goBack();
            }}
          />
        )}
      </AppStack.Screen>

      {/* 重复规则的二级页（spec §4.1.5：重复、提醒各带自己的返回栈） */}
      <AppStack.Screen name="RecurrencePicker">
        {({ navigation, route }) => (
          <RecurrencePickerScreen
            startDateKey={route.params.startDateKey}
            initial={route.params.initial}
            onCancel={() => navigation.goBack()}
            onConfirm={(recurrence) => {
              setRecurrenceSelection((current) => ({ version: current.version + 1, recurrence }));
              navigation.goBack();
            }}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="ReminderPicker">
        {({ navigation, route }) => (
          <ReminderPickerScreen
            initial={route.params.initial}
            onCancel={() => navigation.goBack()}
            onConfirm={(value) => {
              setReminderSelection((current) => ({
                version: current.version + 1,
                minutes: value.minutes,
                sound: value.sound,
              }));
              navigation.goBack();
            }}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="Feedback">
        {({ navigation }) => <FeedbackScreen onBack={() => navigation.goBack()} />}
      </AppStack.Screen>

      <AppStack.Screen name="OrgAccounts">
        {({ navigation }) => <OrgAccountsScreen onBack={() => navigation.goBack()} />}
      </AppStack.Screen>

      <AppStack.Screen name="ProfileEdit">
        {({ navigation }) => <ProfileEditScreen onBack={() => navigation.goBack()} />}
      </AppStack.Screen>

      {/*
        「我的」里的五个分类各是一个**独立路由**（不是同一页换内容）：这样系统返回键能回到「我的」，
        也有正常的转场。实名认证与邮箱绑定更是各自独立——它们本身就是一个两步流程。
      */}
      <AppStack.Screen name="SettingsSection">
        {({ navigation, route }) => (
          <SettingsSectionScreen
            section={route.params.section}
            onBack={() => navigation.goBack()}
            onOpenRealName={() => navigation.navigate('RealName')}
            onOpenEmail={() => navigation.navigate('EmailBind')}
            onOpenPhoneChange={() => navigation.navigate('PhoneChange')}
            onOpenPassword={() => navigation.navigate('Password')}
            onOpenDeletion={() => navigation.navigate('AccountDeletion')}
            onOpenFeedback={() => navigation.navigate('Feedback')}
            onOpenLegal={(doc) => navigation.navigate('Legal', { doc })}
          />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="RealName">
        {({ navigation }) => (
          <RealNameScreen onBack={() => navigation.goBack()} onVerified={() => navigation.goBack()} />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="PhoneChange">
        {({ navigation }) => (
          <PhoneChangeScreen onBack={() => navigation.goBack()} />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="Password">
        {({ navigation }) => <PasswordScreen onBack={() => navigation.goBack()} />}
      </AppStack.Screen>

      <AppStack.Screen name="EmailBind">
        {({ navigation }) => (
          <EmailBindScreen onBack={() => navigation.goBack()} onDone={() => navigation.goBack()} />
        )}
      </AppStack.Screen>

      <AppStack.Screen name="AvatarCrop">
        {({ navigation, route }) => (
          <AvatarCropScreen
            uri={route.params.uri}
            onCancel={() => navigation.goBack()}
            onDone={(uri) => {
              // 裁好就回「我的」页：上传与资料回填都由那一页负责（它持有 profile 状态）
              setAvatarCrop((current) => ({ version: current.version + 1, uri }));
              navigation.goBack();
            }}
          />
        )}
      </AppStack.Screen>

      </AppStack.Navigator>
      <Modal
        transparent
        visible={shareRecognizing}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => undefined}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.28)',
          }}
        >
          <View
            style={{
              minWidth: 228,
              borderRadius: 18,
              paddingHorizontal: 26,
              paddingVertical: 24,
              alignItems: 'center',
              backgroundColor: theme.color.surfaceRaised,
            }}
          >
            <ActivityIndicator color={theme.color.accent} />
            <Text
              style={{
                marginTop: 14,
                color: theme.color.textPrimary,
                fontSize: 16,
                fontWeight: '600',
              }}
            >
              正在识别截图…
            </Text>
            <Text
              style={{
                marginTop: 7,
                color: theme.color.textTertiary,
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              图片只在手机本地识别，不会上传
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Root() {
  const theme = useAppTheme();
  const { runtime, setRuntime } = useRuntimeState();
  const { session, setSession } = useAppSessionState();
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  /**
   * 首启隐私政策同意（规范 §四 D1/D3）。
   *
   * 这一层刻意放在**登录之前、网络请求之前**：
   * 未同意时连会话都不恢复，App 不会发出任何携带个人信息的请求。
   */
  const [consentChecked, setConsentChecked] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(true);
  const consentStoreRef = useRef<ConsentStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 改名遗留（xa-todo.* → chronoflow.*）：**必须在读任何存储之前**搬完，
        // 否则老包升上来的用户会莫名其妙掉登录态、重弹隐私同意
        await withTimeout(
          migrateLegacyStorage(),
          STARTUP_CONSENT_TIMEOUT_MS,
          '迁移本地存储超时',
        );
        const store = await withTimeout(
          createSecureConsentStore(),
          STARTUP_CONSENT_TIMEOUT_MS,
          '初始化隐私存储超时',
        );
        if (cancelled) {
          return;
        }
        consentStoreRef.current = store;
        const record = await withTimeout(
          store.read(),
          STARTUP_CONSENT_TIMEOUT_MS,
          '读取隐私记录超时',
        );
        setNeedsConsent(!hasAcceptedPolicy(record));
      } catch (error) {
        // 安全存储不可用（例如 Web 预览）：按「没同意过」处理，宁可多弹一次
        console.warn('[startup] 隐私状态读取失败，按未同意处理', error);
        if (!cancelled) {
          setNeedsConsent(true);
        }
      } finally {
        if (!cancelled) {
          setConsentChecked(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const acceptConsent = () => {
    const record = buildConsentRecord();
    setNeedsConsent(false);
    const pending = consentStoreRef.current?.write(record);
    void pending?.catch(() => undefined);
  };

  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    setBootError(false);
    void (async () => {
      try {
        const created = await withTimeout(
          createRuntime(() => {
            void setSession(null);
          }),
          STARTUP_RUNTIME_TIMEOUT_MS,
          '启动超时',
        );
        if (cancelled) {
          return;
        }
        setRuntime(created);
        // 冷启动：读取安全存储中的会话，必要时在首次请求前静默续期
        try {
          const restored = await withTimeout(
            created.session.restore(),
            STARTUP_SESSION_TIMEOUT_MS,
            '恢复登录状态超时',
          );
          if (!cancelled) {
            setSession(restored);
          }
        } catch (error) {
          // 会话坏了只影响登录态，不应该把整个 App 卡在启动页
          console.warn('[startup] 恢复登录状态失败，进入登录页', error);
          if (!cancelled) {
            setSession(null);
          }
        }
      } catch (error) {
        console.warn('[startup] 应用初始化失败', error);
        if (!cancelled) {
          setRuntime(null);
          setSession(null);
          setBootError(true);
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt, setRuntime, setSession]);

  if (bootError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
          backgroundColor: theme.color.bg,
        }}
      >
        <Text
          style={{
            color: theme.color.textPrimary,
            fontSize: 18,
            fontWeight: '600',
            textAlign: 'center',
          }}
        >
          启动没有完成
        </Text>
        <Text
          style={{
            color: theme.color.textTertiary,
            fontSize: 14,
            lineHeight: 21,
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          读取本地数据时出了点问题，重新试一次通常就能恢复。
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setBootAttempt((attempt) => attempt + 1)}
          style={({ pressed }) => ({
            marginTop: 24,
            minWidth: 132,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: theme.radius.button,
            backgroundColor: theme.color.accent,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text
            style={{
              color: theme.color.accentContrast,
              fontSize: 15,
              fontWeight: '600',
              textAlign: 'center',
            }}
          >
            重新尝试
          </Text>
        </Pressable>
      </View>
    );
  }

  if (booting || !runtime || !consentChecked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.bg }}>
        <ActivityIndicator color={theme.color.accent} />
        <Text style={{ color: theme.color.textTertiary, marginTop: 12 }}>正在准备…</Text>
      </View>
    );
  }

  if (needsConsent) {
    return <PrivacyConsentScreen onAgree={acceptConsent} onDecline={() => undefined} />;
  }

  /**
   * 应用内更新（spec §4.1.11）：Provider 挂在**同意隐私政策之后**，
   * 所以「同意前不发任何请求」这条依然成立；里面的启动检查是静默的
   * （没网 / 服务端没配发布信息都不会打扰用户），只有真发现新版本才弹。
   */
  return (
    <AppUpdateProvider>{session ? <MainStack /> : <AuthFlow />}</AppUpdateProvider>
  );
}

function ThemedRoot() {
  const theme = useAppTheme();
  const navTheme = useMemo(
    () =>
      theme.scheme === 'dark'
        ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: theme.color.bg, card: theme.color.surfaceRaised, text: theme.color.textPrimary, border: theme.color.border, primary: theme.color.accent } }
        : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: theme.color.bg, card: theme.color.surfaceRaised, text: theme.color.textPrimary, border: theme.color.border, primary: theme.color.accent } },
    [theme],
  );

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer theme={navTheme} ref={navigationRef}>
        <Root />
      </NavigationContainer>
      <ToastHost />
    </>
  );
}

export function App() {
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <SafeAreaProvider>
      <AppProvider systemScheme={systemScheme}>
        <ThemedRoot />
      </AppProvider>
    </SafeAreaProvider>
  );
}

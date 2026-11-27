import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { userFacingError } from '../../../shared/errors';
import {
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '../../../shared/api';
import type { TokenResponse } from '../../../shared/api';
import { PrimaryButton, Screen } from '../../../shared/ui';
import { useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import { canRequestCode, canSubmitLogin, LEGAL_DOCS, type LegalDoc } from '../../compliance/pure';
import {
  accountKind,
  accountIssue,
  accountPlaceholder,
  keyboardFor,
} from '../../../shared/accountIdentifier';
import { loginButtons } from '../domain/loginForm';
import {
  canSubmitPasswordLogin,
  type LoginMode,
} from '../domain/password';
import {
  SMS_COOLDOWN_SECONDS,
  nextCooldown,
  sendCodeLabel,
} from '../domain/smsCooldown';

/**
 * iOS 的 `phone-pad` / `number-pad` 键盘**没有回车键**，点输入框外的空白也不会收起。
 *
 * 登录页原本是不可滚动的居中布局：键盘一弹就把协议勾选框和登录按钮盖在下面，
 * 用户既收不起键盘、又勾不到协议、两个按钮还都是灰的——直接卡死。
 * 这里给两个输入框挂一个带「完成」的 accessory，让键盘永远有明确的收起入口。
 */
const KEYBOARD_ACCESSORY_ID = 'chronoflow-login-keyboard-done';

/**
 * 登录页：**只登录个人账号**（spec §3.2）。
 *
 * 不再有「选身份」这一步——组织账号是在登录后、在组织 tab 的「账户管理」里
 * 用「组织唯一 ID + 成员唯一识别 ID」认领的。
 */
export function LoginScreen({
  onOpenLegal,
  onOpenPasswordReset,
  onOpenRegister,
}: {
  /** 打开《用户服务协议》/《隐私政策》——登录页必须能点开原文（规范 §四） */
  onOpenLegal: (doc: LegalDoc) => void;
  /** 忘记密码：短信验证码验证后重设（未登录状态） */
  onOpenPasswordReset: () => void;
  /** 注册账号：手机号 + 验证码 + 自设密码 */
  onOpenRegister: () => void;
}) {
  const theme = useAppTheme();
  const { api, deviceId } = useRuntime();
  const { applyTokenResponse } = useAppSessionState();

  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  /** 登录方式：短信验证码（默认）/ 手机号 + 密码 */
  const [mode, setMode] = useState<LoginMode>('sms');
  const [password, setPassword] = useState('');
  /**
   * 是否已主动勾选同意协议与隐私政策。
   *
   * **初值必须是 false**：审核规范明确把「用勾选框形式但默认勾选」与
   * 「注册或登录即默认同意」都列为违规。判定逻辑抽在 modules/compliance/domain/consent.ts，由单测盯着。
   */
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  /**
   * 两个请求**各自**一个状态。
   *
   * 曾经共用一个 `busy`：点「获取验证码」时两个按钮一起转圈（用户一眼看出不对）。
   * 判定逻辑在 `domain/loginForm.ts`，由单测盯着「转圈只出现在被点的按钮上」。
   */
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 发码后的倒计时秒数（spec §3.6：同手机号 60 秒 1 条） */
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 每秒递减；到 0 自动结束（依赖 cooldown 本身，定时器随状态重建）
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((current) => nextCooldown(current)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const applyToken = async (token: TokenResponse) => {
    await applyTokenResponse(token);
  };

  const sendCode = async () => {
    setSendingCode(true);
    setError(null);
    try {
      const result = await api.sendSmsCode(account.trim());
      /**
       * 开发环境后端会回显验证码，生产环境该字段不存在。
       *
       * <p>**回显的验证码直接填进输入框，不在界面上写「开发环境验证码」**——
       * 那种字样是给开发看的，用户看到会以为产品出了问题。
       */
      if (result.debugCode) {
        setCode(result.debugCode);
      }
      setCooldown(SMS_COOLDOWN_SECONDS);
    } catch (cause) {
      setError(userFacingError(cause, '验证码发送失败'));
      // 后端说「发送过于频繁」时也进入倒计时：否则用户会一直点、一直失败
      if (cause instanceof ApiError && cause.code === 20005) {
        setCooldown(SMS_COOLDOWN_SECONDS);
      }
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async () => {
    // 前端先做一次格式校验：邮箱写了一半就点登录，直接给「邮箱格式不正确」
    // 比等服务端 400 再回显更快，也不用真发一次请求
    const issue = accountIssue(account);
    if (issue) {
      setError(issue);
      return;
    }
    const ready =
      mode === 'sms'
        ? canSubmitLogin({ account, code, acceptedPolicy })
        : canSubmitPasswordLogin({ account, password, acceptedPolicy });
    if (!ready) {
      setError(
        acceptedPolicy
          ? mode === 'sms'
            ? '请填写手机号与 6 位验证码'
            : '请填写手机号与密码'
          : '请先阅读并勾选同意《用户服务协议》与《隐私政策》',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === 'sms'
          ? await api.loginBySms(account.trim(), code.trim(), deviceId)
          : await api.loginByPassword(account.trim(), password, deviceId);

      if (result.needRegister && result.registerToken) {
        // 首次登录：账号已建，直接创建个人身份进入；昵称可在设置里改
        const token = await api.createPersonalIdentity(
          result.registerToken,
          `用户${account.trim().slice(-4)}`,
          deviceId,
        );
        await applyToken(token);
        return;
      }
      if (result.session) {
        // 已有个人身份：直接把它的会话写进安全存储，进入 App
        await applyToken(result.session);
        return;
      }
      setError('登录返回异常，请重试');
    } catch (cause) {
      setError(userFacingError(cause, '登录失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const loginReady =
    mode === 'sms'
      ? canSubmitLogin({ account, code, acceptedPolicy })
      : canSubmitPasswordLogin({ account, password, acceptedPolicy });
  const buttons = loginButtons({
    sendingCode,
    submitting,
    canRequestCode: canRequestCode(account, cooldown, acceptedPolicy),
    canSubmitLogin: loginReady,
  });

  /**
   * 手机号填满了、但协议还没勾：按钮是灰的，必须说明原因。
   * 否则用户（和审核员）只会觉得 App 卡住了——这正是之前被卡住的那一步。
   */
  const needsConsent = !acceptedPolicy && account.trim().length === 11;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          {/*
            微信式布局（spec 视觉规范「黑白极简」不变，只改排布）：
            顶部大片留白 → 品牌区 → 无边框的横线输入行 → 通栏按钮 → 底部协议。
            与原来的差别：不用卡片包裹、输入框不再是独立方框，而是「标签 + 输入」的一行。
          */}
          <View style={styles.brand}>
            <Text style={[styles.title, { color: theme.color.textPrimary }]}>时纪流</Text>
          </View>

          {/* 登录方式：微信式下用居中的两个文字切换，不用带边框的分段控件 */}
          <View style={styles.modeRow}>
            {([
              { value: 'sms', label: '验证码登录' },
              { value: 'password', label: '密码登录' },
            ] as { value: LoginMode; label: string }[]).map((item) => {
              const active = mode === item.value;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setMode(item.value);
                    setError(null);
                  }}
                  hitSlop={8}
                  style={styles.modeItem}
                >
                  <Text
                    style={[
                      styles.modeText,
                      {
                        color: active ? theme.color.textPrimary : theme.color.textTertiary,
                        fontWeight: active ? '600' : '400',
                      },
                    ]}
                  >
                    {item.label}
                  </Text>
                  <View
                    style={[
                      styles.modeUnderline,
                      { backgroundColor: active ? theme.color.accent : 'transparent' },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          {/* 手机号：一行，标签在左、输入在右，底部一条细线 */}
          <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>账号</Text>
            <TextInput
              value={account}
              onChangeText={setAccount}
              keyboardType={keyboardFor(accountKind(account))}
              inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined}
              placeholder={accountPlaceholder(account)}
              accessibilityLabel="手机号"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              maxLength={11}
              style={[styles.fieldInput, { color: theme.color.textPrimary }]}
            />
          </View>

          {mode === 'sms' ? (
            <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>验证码</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined}
                maxLength={6}
                placeholder="请输入验证码"
                accessibilityLabel="验证码"
                placeholderTextColor={theme.color.textTertiary}
                underlineColorAndroid="transparent"
                style={[styles.fieldInput, { color: theme.color.textPrimary }]}
              />
              {/* 微信式的「获取验证码」是行内文字按钮，不是独立方块按钮 */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: buttons.sendCode.disabled }}
                disabled={buttons.sendCode.disabled}
                hitSlop={8}
                onPress={() => void sendCode()}
                style={styles.codeAction}
              >
                <Text
                  style={{
                    color: buttons.sendCode.disabled
                      ? theme.color.textTertiary
                      : theme.color.accent,
                    fontSize: 15,
                  }}
                >
                  {sendCodeLabel(cooldown, buttons.sendCode.loading)}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>密码</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined}
                placeholder="请输入登录密码"
                accessibilityLabel="密码"
                placeholderTextColor={theme.color.textTertiary}
                underlineColorAndroid="transparent"
                style={[styles.fieldInput, { color: theme.color.textPrimary }]}
              />
            </View>
          )}

          {/* 密码模式下的辅助入口：右对齐的小字链接，与微信「找回密码」同位 */}
          {mode === 'password' ? (
            <View style={styles.helperRow}>
              <Pressable onPress={onOpenRegister} hitSlop={6} accessibilityRole="button">
                <Text style={{ color: theme.color.accent, fontSize: 14 }}>注册账号</Text>
              </Pressable>
              <Pressable onPress={onOpenPasswordReset} hitSlop={6} accessibilityRole="button">
                <Text style={{ color: theme.color.textSecondary, fontSize: 14 }}>找回密码</Text>
              </Pressable>
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: theme.color.danger, fontSize: 14, marginTop: theme.spacing.md }}>
              {error}
            </Text>
          ) : null}

          {needsConsent ? (
            <Text
              style={{ color: theme.color.textTertiary, fontSize: 13, marginTop: theme.spacing.sm }}
            >
              请先勾选下方的协议，才能获取验证码并登录
            </Text>
          ) : null}

          {/*
            通栏主按钮：微信的登录按钮是「接近矩形、圆角 8」的通栏块。
            这里沿用 PrimaryButton（颜色/禁用态已合规），只把外边距按微信的节奏给足。
          */}
          <View style={styles.submitWrap}>
            {/*
              微信的登录按钮是「接近矩形、圆角 8」的通栏块。
              PrimaryButton 默认圆角 12（与日程卡片的按钮一致），这里只把圆角收小，
              颜色 / 禁用态 / loading 全部沿用组件实现——不要为了形状重写一个按钮。
            */}
            <View style={{ borderRadius: 8, overflow: 'hidden' }}>
              <PrimaryButton
                title="登录"
                onPress={() => void submit()}
                loading={buttons.submit.loading}
                disabled={buttons.submit.disabled}
              />
            </View>
          </View>

          {/*
            合规要点（规范 §四「默认同意」）——顺序与样式可以跟着微信走，但这三条不能动：
            1. 用**勾选框**、且默认不勾选；
            2. 协议名要能点开原文；
            3. 未勾选时登录按钮不可点。
            微信把协议放在最底部居中，这里照做：先勾选框，再换行显示协议链接。
          */}
          {/*
            协议区（微信式排布）：勾选框在左，**两段文字同处一列**。
            之前的问题：把第二段单独用 paddingLeft 手动对齐，和上面文字起点差几个像素，
            且勾选框只对齐第一行，换行后就显得错位。现在交给同一个容器统一排版。

            合规要点（规范 §四「默认同意」）不能动：
            1. 用勾选框、且默认不勾选；2. 协议名可点开原文；3. 未勾选时登录按钮不可点。
          */}
          <View style={styles.consent}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedPolicy }}
              accessibilityLabel="我已阅读并同意用户服务协议与隐私政策"
              onPress={() => setAcceptedPolicy(!acceptedPolicy)}
              hitSlop={8}
              style={styles.consentCheckbox}
            >
              <View
                style={[
                  styles.consentBox,
                  {
                    borderColor: acceptedPolicy ? theme.color.accent : theme.color.border,
                    backgroundColor: acceptedPolicy ? theme.color.accent : 'transparent',
                  },
                ]}
              >
                {acceptedPolicy ? (
                  <Ionicons
                    name="checkmark"
                    size={12}
                    color={theme.color.accentContrast}
                  />
                ) : null}
              </View>
            </Pressable>

            <View style={styles.consentText}>
              <Text style={[styles.consentLine, { color: theme.color.textTertiary }]}>
                {/* 用 title（短名）而不是 label：《时纪流用户服务协议》会把一行撑成两行 */}
                我已阅读并同意
                <Text
                  onPress={() => onOpenLegal('user-agreement')}
                  style={{ color: theme.color.accent }}
                >
                  《{LEGAL_DOCS['user-agreement'].title}》
                </Text>
                与
                <Text
                  onPress={() => onOpenLegal('privacy-policy')}
                  style={{ color: theme.color.accent }}
                >
                  《{LEGAL_DOCS['privacy-policy'].title}》
                </Text>
              </Text>
              <Text style={[styles.consentLine, styles.consentHint, { color: theme.color.textTertiary }]}>
                未满 18 周岁请在监护人陪同下阅读
                <Text
                  onPress={() => onOpenLegal('children-privacy')}
                  style={{ color: theme.color.accent }}
                >
                  《{LEGAL_DOCS['children-privacy'].title}》
                </Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      </Screen>
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={KEYBOARD_ACCESSORY_ID}>
          <View style={styles.accessory}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="收起键盘"
              hitSlop={8}
              onPress={() => Keyboard.dismiss()}
            >
              <Text style={[styles.accessoryDone, { color: theme.color.accent }]}>完成</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /**
   * 微信登录页的节奏：顶部约 1/4 屏留白，内容贴左，底部留白收尾。
   * 不用 `justifyContent: 'center'`——居中会让小屏 + 键盘时上下都挤。
   */
  content: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: 96,
    paddingBottom: 40,
  },

  brand: { marginBottom: 48 },
  title: { fontSize: 30, fontWeight: '600', letterSpacing: -0.5 },

  /** 登录方式：两个文字页签，选中态用下划线（不用带边框的分段控件） */
  modeRow: { flexDirection: 'row', gap: 28, marginBottom: 8 },
  modeItem: { paddingBottom: 8 },
  modeText: { fontSize: 15 },
  modeUnderline: { height: 2, marginTop: 6, borderRadius: 1 },

  /** 一行输入：标签在左、输入在右，只有底部一条细线 */
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
  },
  /** 宽度按最长的标签「验证码」算：窄了它就直接贴住输入框 */
  fieldLabel: { width: 64, fontSize: 16, marginRight: 12 },
  fieldInput: { flex: 1, fontSize: 16, padding: 0 },
  codeAction: { paddingLeft: 12 },

  helperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },

  submitWrap: { marginTop: 40 },

  /** 协议区：勾选框与文字同处一行，文字整体成列（微信式） */
  consent: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  consentCheckbox: { paddingTop: 2, marginRight: 10 },
  consentBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentText: { flex: 1 },
  consentLine: { fontSize: 12, lineHeight: 18 },
  consentHint: { marginTop: 6 },

  accessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#C6C6C8',
    backgroundColor: '#F2F2F7',
  },
  accessoryDone: { fontSize: 16, fontWeight: '600' },
});


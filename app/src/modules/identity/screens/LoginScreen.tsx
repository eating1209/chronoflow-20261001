import { useEffect, useState } from 'react';
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
import { SegmentedControl } from '../../../shared/ui';
import { Card, Checkbox, PrimaryButton, Screen } from '../../../shared/ui';
import { useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import { canRequestCode, canSubmitLogin, LEGAL_DOCS, type LegalDoc } from '../../compliance/pure';
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

  const [phone, setPhone] = useState('');
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
      const result = await api.sendSmsCode(phone.trim());
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
    const ready =
      mode === 'sms'
        ? canSubmitLogin({ phone, code, acceptedPolicy })
        : canSubmitPasswordLogin({ phone, password, acceptedPolicy });
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
          ? await api.loginBySms(phone.trim(), code.trim(), deviceId)
          : await api.loginByPassword(phone.trim(), password, deviceId);

      if (result.needRegister && result.registerToken) {
        // 首次登录：账号已建，直接创建个人身份进入；昵称可在设置里改
        const token = await api.createPersonalIdentity(
          result.registerToken,
          `用户${phone.trim().slice(-4)}`,
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
      ? canSubmitLogin({ phone, code, acceptedPolicy })
      : canSubmitPasswordLogin({ phone, password, acceptedPolicy });
  const buttons = loginButtons({
    sendingCode,
    submitting,
    canRequestCode: canRequestCode(phone, cooldown, acceptedPolicy),
    canSubmitLogin: loginReady,
  });

  /**
   * 手机号填满了、但协议还没勾：按钮是灰的，必须说明原因。
   * 否则用户（和审核员）只会觉得 App 卡住了——这正是之前被卡住的那一步。
   */
  const needsConsent = !acceptedPolicy && phone.trim().length === 11;

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
      <View style={{ marginBottom: theme.spacing.lg }}>
        <Text style={[styles.title, { color: theme.color.textPrimary }]}>时纪流</Text>
        <Text style={{ color: theme.color.textSecondary }}>ChronoFlow</Text>
      </View>

      <Card>
        <View style={{ marginBottom: theme.spacing.lg }}>
          <SegmentedControl<LoginMode>
            label="登录方式"
            options={[
              { value: 'sms', label: '验证码登录' },
              { value: 'password', label: '密码登录' },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
          />
        </View>

        <Text style={[styles.label, { color: theme.color.textSecondary }]}>手机号</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined}
          placeholder="11 位手机号"
          accessibilityLabel="手机号"
          placeholderTextColor={theme.color.textTertiary}
            underlineColorAndroid="transparent"
          style={[
            styles.input,
            { color: theme.color.textPrimary, borderColor: theme.color.border, borderRadius: theme.radius.input },
          ]}
        />

        <View style={{ height: theme.spacing.md }} />

        {mode === 'sms' ? (
          <>
            <Text style={[styles.label, { color: theme.color.textSecondary }]}>验证码</Text>
            <View style={styles.codeRow}>
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined}
                maxLength={6}
                placeholder="6 位数字"
                accessibilityLabel="验证码"
                placeholderTextColor={theme.color.textTertiary}
            underlineColorAndroid="transparent"
                style={[
                  styles.input,
                  styles.codeInput,
                  { color: theme.color.textPrimary, borderColor: theme.color.border, borderRadius: theme.radius.input },
                ]}
              />
              <View style={styles.codeButton}>
                <PrimaryButton
                  title={sendCodeLabel(cooldown, buttons.sendCode.loading)}
                  onPress={() => void sendCode()}
                  loading={buttons.sendCode.loading}
                  // 冷却中 / 另一个请求在飞时也禁用：点不动比点了报错更省事
                  disabled={buttons.sendCode.disabled}
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: theme.color.textSecondary }]}>密码</Text>
            <View style={[styles.inputBox, { borderColor: theme.color.border, borderRadius: theme.radius.input }]}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined}
                placeholder="设置过的登录密码"
                accessibilityLabel="密码"
                placeholderTextColor={theme.color.textTertiary}
                underlineColorAndroid="transparent"
                style={[styles.inputInner, { color: theme.color.textPrimary }]}
              />
            </View>
            <View style={styles.helperRow}>
              <Text
                onPress={onOpenRegister}
                accessibilityRole="button"
                style={{ color: theme.color.accent, fontSize: 13 }}
              >
                还没有账号？立即注册
              </Text>
              <Text
                onPress={onOpenPasswordReset}
                accessibilityRole="button"
                style={{ color: theme.color.accent, fontSize: 13 }}
              >
                忘记密码？
              </Text>
            </View>
          </>
        )}

        {error ? (
          <Text style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.spacing.sm }}>{error}</Text>
        ) : null}

        {needsConsent ? (
          <Text style={{ color: theme.color.textTertiary, fontSize: 12, marginTop: theme.spacing.sm }}>
            请先勾选下方的协议，才能获取验证码并登录
          </Text>
        ) : null}

        <View style={{ height: theme.spacing.lg }} />
        <PrimaryButton
          title={mode === 'sms' ? '登录 / 注册' : '登录'}
          onPress={() => void submit()}
          loading={buttons.submit.loading}
          disabled={buttons.submit.disabled}
        />

        {/*
          合规要点（规范 §四「默认同意」）：
          1. 用**勾选框**、且默认不勾选；
          2. 协议名要能点开原文，而不是只写一行小字；
          3. 未勾选时登录按钮不可点，也不再出现「登录即表示同意」这种替代同意的写法。
        */}
        <View style={{ marginTop: theme.spacing.md }}>
          <Checkbox
            value={acceptedPolicy}
            onToggle={setAcceptedPolicy}
            accessibilityLabel="我已阅读并同意用户服务协议与隐私政策"
          >
            <Text style={{ color: theme.color.textSecondary, fontSize: 13, lineHeight: 20 }}>
              我已阅读并同意
              <Text onPress={() => onOpenLegal('user-agreement')} style={{ color: theme.color.accent }}>
                {LEGAL_DOCS['user-agreement'].label}
              </Text>
              与
              <Text onPress={() => onOpenLegal('privacy-policy')} style={{ color: theme.color.accent }}>
                {LEGAL_DOCS['privacy-policy'].label}
              </Text>
            </Text>
          </Checkbox>
          <Text
            style={{
              color: theme.color.textTertiary,
              fontSize: 12,
              marginTop: 6,
              lineHeight: 18,
            }}
          >
            未满 18 周岁请在监护人陪同下阅读；
            <Text
              onPress={() => onOpenLegal('children-privacy')}
              style={{ color: theme.color.accent }}
            >
              {LEGAL_DOCS['children-privacy'].label}
            </Text>
          </Text>
        </View>
        </Card>
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
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
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
  title: { fontSize: 34, fontWeight: '600', letterSpacing: -0.5 },
  label: { fontSize: 13, marginBottom: 6 },
  input: { height: 48, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  inputBox: { height: 48, borderWidth: 1, paddingHorizontal: 12, justifyContent: 'center' },
  inputInner: { flex: 1, fontSize: 16, padding: 0, backgroundColor: 'transparent' },
  codeRow: { flexDirection: 'row', alignItems: 'center' },
  codeInput: { flex: 1 },
  codeButton: { width: 132, marginLeft: 12 },
  helperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
});

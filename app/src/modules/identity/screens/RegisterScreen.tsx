import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, Screen } from '../../../shared/ui';
import { useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import { userFacingError } from '../../../shared/errors';
import { LEGAL_DOCS, type LegalDoc } from '../../compliance/pure';
import { passwordIssue, passwordsMatch } from '../domain/password';
import { SMS_COOLDOWN_SECONDS, nextCooldown, sendCodeLabel } from '../domain/smsCooldown';
import {
  accountIssue,
  accountKind,
  accountPlaceholder,
  keyboardFor,
} from '../../../shared/accountIdentifier';

/**
 * 注册账号：手机号 + 短信验证码 + 自设密码。
 *
 * <p>**必须先收到验证码**：验证码证明这个手机号在本人手里，否则任何人都能拿别人的号码注册。
 * 已注册的号码会被后端明确拒绝，引导去登录或走「忘记密码」，不会静默改掉别人的密码。
 */
export function RegisterScreen({
  onBack,
  onOpenLegal,
  onNeedBindPhone,
}: {
  onBack: () => void;
  /** 注册页同样要能点开协议原文——勾选同意不能只是一句默认文案 */
  onOpenLegal: (doc: LegalDoc) => void;
  /**
   * 邮箱注册成功后调用：引导用户绑定手机号。
   *
   * <p>为什么邮箱注册要绑手机号：手机号在本产品里是**登录凭证**之一，
   * 也是日程提醒的接收方。只有邮箱的话，用户换设备或忘记邮箱密码就没法自证身份。
   * 手机号注册的账号本身就有手机号，不需要这一步。
   */
  onNeedBindPhone: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { api, deviceId } = useRuntime();
  const { applyTokenResponse } = useAppSessionState();

  const [account, setAccount] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((current) => nextCooldown(current)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // 账号可以是手机号或邮箱：用共享识别规则判，与登录页保持一致
  const accountOk = accountIssue(account) === null;
  const ready =
    accountOk
    && code.trim().length === 6
    && passwordIssue(password) === null
    && passwordsMatch(password, confirm)
    && acceptedPolicy;

  const sendCode = async () => {
    if (!accountOk) {
      setError(accountIssue(account) ?? '请先填写手机号或邮箱');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.sendSmsCode(account.trim());
      setCooldown(SMS_COOLDOWN_SECONDS);
    } catch (cause) {
      setError(userFacingError(cause, '验证码发送失败'));
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (!acceptedPolicy) {
      setError('请先阅读并勾选同意《用户服务协议》与《隐私政策》');
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      setError(issue);
      return;
    }
    if (!passwordsMatch(password, confirm)) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.registerWithPassword(account.trim(),
        code.trim(),
        password,
        deviceId,
      );
      // 邮箱注册：先把会话落到本地（绑定手机号要带令牌），再进绑定页
      const needsBindPhone = accountKind(account) === 'EMAIL';

      if (result.needRegister && result.registerToken) {
        // 新账号还没有个人身份：建一个再进 App（昵称可在设置里改）
        const token = await api.createPersonalIdentity(
          result.registerToken,
          `用户${account.trim().slice(-4)}`,
          deviceId,
        );
        await applyTokenResponse(token);
        if (needsBindPhone) {
          onNeedBindPhone();
        }
        return;
      }
      if (result.session) {
        await applyTokenResponse(result.session);
        if (needsBindPhone) {
          onNeedBindPhone();
        }
        return;
      }
      setError('注册返回异常，请重试');
    } catch (cause) {
      setError(userFacingError(cause, '注册失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen style={[styles.flex, { backgroundColor: theme.color.bg }]}>
        {/* 页头与登录页同一套：左「返回」、中标题、右留白 */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: theme.color.border,
              // AuthStack 的 headerShown 是 false，自绘页头必须自己避开状态栏，
              // 否则「返回 / 注册」会压在时间与电量上
              paddingTop: insets.top + 14,
            },
          ]}
        >
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={{ color: theme.color.accent, fontSize: 16 }}>返回</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: theme.color.textPrimary }]}>注册</Text>
          {/* 右侧等宽占位：不占的话标题会被左边的「返回」顶偏 */}
          <View style={styles.headerSide} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          {/*
            微信式排布，与登录页一致：不留卡片、一行一个输入（标签左、值右）、底部一条细线。
            用户在登录与注册之间来回时手感一致。
          */}
          <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>账号</Text>
            <TextInput
              value={account}
              onChangeText={setAccount}
              keyboardType={keyboardFor(accountKind(account))}
              maxLength={account.includes('@') ? 64 : 11}
              placeholder={accountPlaceholder(account)}
              accessibilityLabel="账号"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.fieldInput, { color: theme.color.textPrimary }]}
            />
          </View>

          <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>验证码</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="请输入验证码"
              accessibilityLabel="验证码"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.fieldInput, { color: theme.color.textPrimary }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: sending || cooldown > 0 || !accountOk }}
              disabled={sending || cooldown > 0 || !accountOk}
              hitSlop={8}
              onPress={() => void sendCode()}
              style={styles.codeAction}
            >
              <Text
                style={{
                  color:
                    sending || cooldown > 0 || !accountOk
                      ? theme.color.textTertiary
                      : theme.color.accent,
                  fontSize: 15,
                }}
              >
                {sendCodeLabel(cooldown, sending)}
              </Text>
            </Pressable>
          </View>

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
              placeholder="8-20 位，不含空格"
              accessibilityLabel="设置密码"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.fieldInput, { color: theme.color.textPrimary }]}
            />
          </View>

          <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>确认</Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              placeholder="再输入一次密码"
              accessibilityLabel="确认密码"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.fieldInput, { color: theme.color.textPrimary }]}
            />
          </View>

          {error ? (
            <Text style={{ color: theme.color.danger, fontSize: 14, marginTop: theme.spacing.md }}>
              {error}
            </Text>
          ) : null}

          {/*
            邮箱注册的账号没有手机号。手机号在本产品里是登录凭证之一，
            所以注册后立刻引导绑定；手机号注册的账号不需要这一步。
          */}
          {accountKind(account) === 'EMAIL' ? (
            <Text
              style={{
                color: theme.color.textTertiary,
                fontSize: 13,
                lineHeight: 19,
                marginTop: theme.spacing.md,
              }}
            >
              用邮箱注册后需要再绑定一个手机号；绑定后可在「我的 → 账号与安全」里随时更换。
            </Text>
          ) : null}

          <View style={styles.submitWrap}>
            {/* 圆角 8：与登录页的主按钮形状一致 */}
            <View style={{ borderRadius: 8, overflow: 'hidden' }}>
              <PrimaryButton
                title="注册并登录"
                onPress={() => void submit()}
                loading={busy}
                disabled={!ready}
              />
            </View>
          </View>

          {/* 协议区与登录页同一套：勾选框在左，文字在右侧一列 */}
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
                  <Ionicons name="checkmark" size={12} color={theme.color.accentContrast} />
                ) : null}
              </View>
            </Pressable>
            <View style={styles.consentText}>
              <Text style={[styles.consentLine, { color: theme.color.textTertiary }]}>
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
              {/*
                与登录页同一条未成年人声明。
                法规要求「未成年人需在监护人陪同下阅读并在同意后使用」（隐私政策 §八），
                只在登录页写、注册页不写是个真缺口——注册才是用户**开始**提供个人信息的那一步。
                这里不做年龄校验：产品没有生日字段，凭空加一道门禁会把注册流程拖长，
                而声明文本已经满足了「明确告知」的要求。
              */}
              <Text
                style={[
                  styles.consentLine,
                  styles.consentHint,
                  { color: theme.color.textTertiary },
                ]}
              >
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 32 },
  headerTitle: { fontSize: 17, fontWeight: '600' },

  content: { paddingHorizontal: 32, paddingTop: 24, paddingBottom: 40 },

  /** 一行输入：与登录页同一套（标签左、输入右、底部一条细线） */
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 18,
  },
  fieldLabel: { width: 52, fontSize: 16, marginRight: 12 },
  fieldInput: { flex: 1, fontSize: 16, padding: 0 },
  codeAction: { paddingLeft: 12 },

  submitWrap: { marginTop: 32 },

  consent: { marginTop: 24, flexDirection: 'row', alignItems: 'flex-start' },
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
});

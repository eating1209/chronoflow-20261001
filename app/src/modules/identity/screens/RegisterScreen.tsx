import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { EditorHeader } from '../../../shared/ui';
import { Card, Checkbox, PrimaryButton, Screen } from '../../../shared/ui';
import { useAppSessionState, useAppTheme, useRuntime } from '../../../context/AppContext';
import { userFacingError } from '../../../shared/errors';
import { LEGAL_DOCS, type LegalDoc } from '../../compliance/pure';
import { passwordIssue, passwordsMatch } from '../domain/password';
import { SMS_COOLDOWN_SECONDS, nextCooldown, sendCodeLabel } from '../domain/smsCooldown';

/**
 * 注册账号：手机号 + 短信验证码 + 自设密码。
 *
 * <p>**必须先收到验证码**：验证码证明这个手机号在本人手里，否则任何人都能拿别人的号码注册。
 * 已注册的号码会被后端明确拒绝，引导去登录或走「忘记密码」，不会静默改掉别人的密码。
 */
export function RegisterScreen({
  onBack,
  onOpenLegal,
}: {
  onBack: () => void;
  /** 注册页同样要能点开协议原文——勾选同意不能只是一句默认文案 */
  onOpenLegal: (doc: LegalDoc) => void;
}) {
  const theme = useAppTheme();
  const { api, deviceId } = useRuntime();
  const { applyTokenResponse } = useAppSessionState();

  const [phone, setPhone] = useState('');
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

  const phoneOk = /^1\d{10}$/.test(phone.trim());
  const ready =
    phoneOk
    && code.trim().length === 6
    && passwordIssue(password) === null
    && passwordsMatch(password, confirm)
    && acceptedPolicy;

  const sendCode = async () => {
    if (!phoneOk) {
      setError('请先填写正确的手机号');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.sendSmsCode(phone.trim());
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
      const result = await api.registerWithPassword(
        phone.trim(),
        code.trim(),
        password,
        deviceId,
      );
      if (result.needRegister && result.registerToken) {
        // 新账号还没有个人身份：建一个再进 App（昵称可在设置里改）
        const token = await api.createPersonalIdentity(
          result.registerToken,
          `用户${phone.trim().slice(-4)}`,
          deviceId,
        );
        await applyTokenResponse(token);
        return;
      }
      if (result.session) {
        await applyTokenResponse(result.session);
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
    <Screen>
      <EditorHeader title="注册账号" cancelLabel="返回" onCancel={onBack} />
      <View style={styles.body}>
        <Card>
          <Text style={[styles.label, { color: theme.color.textSecondary }]}>手机号</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={11}
            placeholder="11 位手机号"
            accessibilityLabel="手机号"
            placeholderTextColor={theme.color.textTertiary}
            underlineColorAndroid="transparent"
            style={[styles.input, { color: theme.color.textPrimary, borderColor: theme.color.border }]}
          />

          <View style={{ height: theme.spacing.md }} />
          <Text style={[styles.label, { color: theme.color.textSecondary }]}>验证码</Text>
          <View style={styles.row}>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="6 位数字"
              accessibilityLabel="验证码"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.input, styles.flex, { color: theme.color.textPrimary, borderColor: theme.color.border }]}
            />
            <View style={styles.codeButton}>
              <PrimaryButton
                title={sendCodeLabel(cooldown, sending)}
                onPress={() => void sendCode()}
                loading={sending}
                disabled={sending || cooldown > 0 || !phoneOk}
              />
            </View>
          </View>

          <View style={{ height: theme.spacing.md }} />
          <Text style={[styles.label, { color: theme.color.textSecondary }]}>设置密码</Text>
          <View style={[styles.inputBox, { borderColor: theme.color.border }]}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              placeholder="8-20 位"
              accessibilityLabel="设置密码"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.inputInner, { color: theme.color.textPrimary }]}
            />
          </View>

          <View style={{ height: theme.spacing.md }} />
          <Text style={[styles.label, { color: theme.color.textSecondary }]}>确认密码</Text>
          <View style={[styles.inputBox, { borderColor: theme.color.border }]}>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              placeholder="再输入一次"
              accessibilityLabel="确认密码"
              placeholderTextColor={theme.color.textTertiary}
              underlineColorAndroid="transparent"
              style={[styles.inputInner, { color: theme.color.textPrimary }]}
            />
          </View>

          {error ? (
            <Text style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.spacing.sm }}>{error}</Text>
          ) : null}

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
          </View>

          <View style={{ height: theme.spacing.lg }} />
          <PrimaryButton title="注册并登录" onPress={() => void submit()} loading={busy} disabled={!ready} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  label: { fontSize: 13, marginBottom: 6 },
  input: { height: 48, borderWidth: 1, paddingHorizontal: 12, fontSize: 16, borderRadius: 10 },
  inputBox: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center' },
  inputInner: { flex: 1, fontSize: 16, padding: 0, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  codeButton: { width: 132, marginLeft: 12 },
});

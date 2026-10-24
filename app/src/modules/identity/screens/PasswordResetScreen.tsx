import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { EditorHeader } from '../../../shared/ui';
import { Card, PrimaryButton, Screen } from '../../../shared/ui';
import { useAppTheme, useRuntime } from '../../../context/AppContext';
import { userFacingError } from '../../../shared/errors';
import { passwordIssue, passwordsMatch } from '../domain/password';
import { SMS_COOLDOWN_SECONDS, nextCooldown, sendCodeLabel } from '../domain/smsCooldown';

/**
 * 忘记密码（未登录）：手机号 + 短信验证码 → 设置新密码。
 *
 * <p>能收到这条短信就证明手机号还在本人手里，所以不需要旧密码；
 * 重置成功后服务端会吊销所有设备的刷新令牌，旧登录态需要重新登录。
 */
export function PasswordResetScreen({ onBack }: { onBack: () => void }) {
  const theme = useAppTheme();
  const { api } = useRuntime();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
  const ready = phoneOk && code.trim().length === 6 && passwordIssue(password) === null
    && passwordsMatch(password, confirm);

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
      await api.resetPassword(phone.trim(), code.trim(), password);
      Alert.alert('密码已重置', '请用新密码登录。', [{ text: '好', onPress: onBack }]);
    } catch (cause) {
      setError(userFacingError(cause, '重置密码失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <EditorHeader title="忘记密码" cancelLabel="返回" onCancel={onBack} />
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
          <Text style={[styles.label, { color: theme.color.textSecondary }]}>新密码</Text>
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
            accessibilityLabel="新密码"
            placeholderTextColor={theme.color.textTertiary}
            underlineColorAndroid="transparent"
              style={[styles.inputInner, { color: theme.color.textPrimary }]}
            />
          </View>

          <View style={{ height: theme.spacing.md }} />
          <Text style={[styles.label, { color: theme.color.textSecondary }]}>确认新密码</Text>
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
            accessibilityLabel="确认新密码"
            placeholderTextColor={theme.color.textTertiary}
            underlineColorAndroid="transparent"
              style={[styles.inputInner, { color: theme.color.textPrimary }]}
            />
          </View>

          {error ? (
            <Text style={{ color: theme.color.danger, fontSize: 13, marginTop: theme.spacing.sm }}>{error}</Text>
          ) : null}

          <View style={{ height: theme.spacing.lg }} />
          <PrimaryButton title="重置密码" onPress={() => void submit()} loading={busy} disabled={!ready} />
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

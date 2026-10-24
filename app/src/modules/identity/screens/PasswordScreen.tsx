import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { EditorHeader } from '../../../shared/ui';
import { Card, PrimaryButton, Screen } from '../../../shared/ui';
import { useAppTheme, useRuntime } from '../../../context/AppContext';
import { userFacingError } from '../../../shared/errors';
import { passwordIssue, passwordsMatch } from '../domain/password';

/**
 * 「我的 → 账号与安全 → 登录密码」：设置或修改密码。
 *
 * <p>账号已有密码时必须给旧密码（服务端强制）；没有密码时直接设新密码——
 * 短信注册的老账号第一次进来就是这种状态。改密成功后服务端会吊销其它设备的刷新令牌。
 */
export function PasswordScreen({ onBack }: { onBack: () => void }) {
  const theme = useAppTheme();
  const { api } = useRuntime();

  /** null = 还在读；true/false = 是否已设置密码，决定要不要显示「原密码」 */
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .meSecurity()
      .then((view) => setPasswordSet(view.passwordSet))
      .catch(() => setPasswordSet(false));
  }, [api]);

  const ready =
    passwordSet !== null
    && (passwordSet ? oldPassword.length > 0 : true)
    && passwordIssue(password) === null
    && passwordsMatch(password, confirm);

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
      await api.setPassword({
        oldPassword: passwordSet ? oldPassword : undefined,
        newPassword: password,
      });
      Alert.alert(passwordSet ? '密码已修改' : '密码已设置', '其它设备需要重新登录。', [
        { text: '好', onPress: onBack },
      ]);
    } catch (cause) {
      setError(userFacingError(cause, '保存密码失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <EditorHeader title="登录密码" cancelLabel="返回" onCancel={onBack} />
      <View style={styles.body}>
        <Card>
          <Text style={{ color: theme.color.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {passwordSet
              ? '修改后，其它设备上的登录状态会失效，需要重新登录。'
              : '设置密码后，可以用「手机号 + 密码」或「手机号 + 验证码」两种方式登录。'}
          </Text>

          {passwordSet ? (
            <>
              <View style={{ height: theme.spacing.md }} />
              <Text style={[styles.label, { color: theme.color.textSecondary }]}>原密码</Text>
              <View style={[styles.inputBox, { borderColor: theme.color.border }]}>
                <TextInput
                value={oldPassword}
                onChangeText={setOldPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                placeholder="当前登录密码"
                accessibilityLabel="原密码"
                placeholderTextColor={theme.color.textTertiary}
                underlineColorAndroid="transparent"
                  style={[styles.inputInner, { color: theme.color.textPrimary }]}
                />
              </View>
            </>
          ) : null}

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
          <PrimaryButton
            title={passwordSet ? '修改密码' : '设置密码'}
            onPress={() => void submit()}
            loading={busy}
            disabled={!ready}
          />
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
});

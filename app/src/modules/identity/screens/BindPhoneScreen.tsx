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

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, Screen } from '../../../shared/ui';
import { useAppTheme, useRuntime } from '../../../context/AppContext';
import { userFacingError } from '../../../shared/errors';
import { SMS_COOLDOWN_SECONDS, nextCooldown, sendCodeLabel } from '../domain/smsCooldown';

/**
 * 首次绑定手机号（邮箱注册后的引导步骤）。
 *
 * <p>为什么需要单独一页，而不复用 `PhoneChangeScreen`：那一页是「换绑」——
 * 要用户证明自己是本人（旧号验证码或邮箱验证码二选一）。而**首次绑定**时账号压根没有手机号，
 * 没有旧号可验；调用方已经持有该账号的有效令牌、邮箱本身就是它的登录凭证，
 * 所以只需要证明**新手机号可用**（一个短信验证码）。
 *
 * <p>把这两种语义塞进一页，用户会看到一堆与自己无关的选项
 * （「用旧号验证」在首次绑定时根本不可能）。分开之后两页各管一件事。
 */
export function BindPhoneScreen({
  onDone,
  onSkip,
}: {
  /** 绑定成功 */
  onDone: () => void;
  /** 先跳过——「我的 → 账号与安全」里随时可以补上 */
  onSkip: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { api } = useRuntime();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
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

  const phoneOk = /^1[3-9]\d{9}$/.test(phone.trim());
  const ready = phoneOk && code.trim().length === 6;

  const sendCode = async () => {
    if (!phoneOk) {
      setError('请输入 11 位手机号');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await api.sendPhoneCode(phone.trim());
      // 开发环境后端会回显验证码，直接填进输入框（与登录页同一套做法）
      if (result.debugCode) {
        setCode(result.debugCode);
      }
      setCooldown(SMS_COOLDOWN_SECONDS);
    } catch (cause) {
      setError(userFacingError(cause, '验证码发送失败'));
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 首次绑定：只传新号与新号验证码，不传 oldCode / emailCode
      await api.changePhone({ newPhone: phone.trim(), newCode: code.trim() });
      onDone();
    } catch (cause) {
      setError(userFacingError(cause, '绑定失败'));
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
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 48 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.title, { color: theme.color.textPrimary }]}>绑定手机号</Text>
          <Text style={[styles.lead, { color: theme.color.textSecondary }]}>
            你的账号是用邮箱注册的。绑定手机号后可以用它接收日程提醒，
            也可以用手机号验证码登录。
          </Text>

          <View style={{ height: 28 }} />

          <View style={[styles.field, { borderBottomColor: theme.color.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>手机号</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={11}
              placeholder="请输入手机号"
              accessibilityLabel="手机号"
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
              accessibilityState={{ disabled: sending || cooldown > 0 || !phoneOk }}
              disabled={sending || cooldown > 0 || !phoneOk}
              hitSlop={8}
              onPress={() => void sendCode()}
              style={styles.codeAction}
            >
              <Text
                style={{
                  color:
                    sending || cooldown > 0 || !phoneOk
                      ? theme.color.textTertiary
                      : theme.color.accent,
                  fontSize: 15,
                }}
              >
                {sendCodeLabel(cooldown, sending)}
              </Text>
            </Pressable>
          </View>

          {error ? (
            <Text style={{ color: theme.color.danger, fontSize: 14, marginTop: theme.spacing.md }}>
              {error}
            </Text>
          ) : null}

          <View style={styles.submitWrap}>
            <View style={{ borderRadius: 8, overflow: 'hidden' }}>
              <PrimaryButton
                title="绑定"
                onPress={() => void submit()}
                loading={busy}
                disabled={!ready}
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onSkip}
            hitSlop={8}
            style={styles.skip}
          >
            <Text style={{ color: theme.color.textSecondary, fontSize: 15 }}>稍后绑定</Text>
          </Pressable>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 32, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.3 },
  lead: { fontSize: 14, lineHeight: 21, marginTop: 10 },

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
  skip: { alignItems: 'center', marginTop: 20, paddingVertical: 8 },
});

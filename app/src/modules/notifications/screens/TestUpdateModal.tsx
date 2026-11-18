import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppTheme } from '../../../context/AppContext';
import { TEST_UPDATE_URLS } from '../domain/testUpdate';

/**
 * 隐藏的「测试更新」弹窗：长按设置页的「检查更新」才出现。
 *
 * <p>它只下载用户自己填的 APK 直链，不读写线上的发布信息，
 * 所以其他用户完全看不到这个入口，也不会被测试包打扰。
 */
export function TestUpdateModal({
  visible,
  initialUrl,
  defaultUrl,
  busy,
  progress,
  error,
  onClose,
  onSubmit,
  onClear,
  onCancelDownload,
}: {
  visible: boolean;
  /** 已保存的测试地址；空串表示还没配置过 */
  initialUrl: string;
  /** 没配置过时预填的地址，省得每次手打 */
  defaultUrl: string;
  busy: boolean;
  progress: number;
  error: string | null;
  onClose: () => void;
  onSubmit: (url: string) => void;
  onClear: () => void;
  onCancelDownload: () => void;
}) {
  const theme = useAppTheme();
  const [url, setUrl] = useState(initialUrl);

  useEffect(() => {
    if (visible) {
      setUrl(initialUrl || defaultUrl);
    }
  }, [defaultUrl, initialUrl, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (busy) {
          onCancelDownload();
        } else {
          onClose();
        }
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={[styles.card, { backgroundColor: theme.color.surface }]}>
          <Text style={[styles.title, { color: theme.color.textPrimary }]}>测试更新</Text>
          <Text style={[styles.note, { color: theme.color.textSecondary }]}>
            仅供开发测试：粘贴 APK 直链，下载后由系统安装器完成安装。不会改动线上发布版本。
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            editable={!busy}
            placeholder={TEST_UPDATE_URLS.direct}
            placeholderTextColor={theme.color.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[
              styles.input,
              {
                color: theme.color.textPrimary,
                backgroundColor: theme.color.surfaceRaised,
                borderColor: theme.color.border,
              },
            ]}
          />
          <View style={styles.presets}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="使用直连线路"
              disabled={busy}
              hitSlop={8}
              onPress={() => setUrl(TEST_UPDATE_URLS.direct)}
            >
              <Text style={{ color: theme.color.accent, fontSize: 13 }}>直连（快）</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="使用域名线路"
              disabled={busy}
              hitSlop={8}
              onPress={() => setUrl(TEST_UPDATE_URLS.domain)}
            >
              <Text style={{ color: theme.color.textSecondary, fontSize: 13 }}>域名（稳）</Text>
            </Pressable>
          </View>
          {error ? (
            <Text style={[styles.error, { color: theme.color.danger }]}>{error}</Text>
          ) : null}
          {busy ? (
            <Text style={[styles.progress, { color: theme.color.textSecondary }]}>
              {progress > 0 ? `正在下载 ${Math.round(progress * 100)}%` : '正在下载…'}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? '取消下载' : '取消'}
              hitSlop={8}
              onPress={busy ? onCancelDownload : onClose}
            >
              <Text style={{ color: theme.color.textSecondary, fontSize: 15 }}>
                {busy ? '取消下载' : '取消'}
              </Text>
            </Pressable>
            <View style={styles.rightActions}>
              {initialUrl ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="清除测试地址"
                  disabled={busy}
                  hitSlop={8}
                  onPress={onClear}
                >
                  <Text style={{ color: theme.color.textTertiary, fontSize: 15 }}>清除</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={busy ? '正在下载' : '下载并安装'}
                disabled={busy}
                hitSlop={8}
                onPress={() => onSubmit(url)}
              >
                <Text
                  style={{
                    color: busy ? theme.color.textTertiary : theme.color.accent,
                    fontSize: 15,
                    fontWeight: '600',
                  }}
                >
                  {busy ? '下载中…' : '下载并安装'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 19, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  input: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  presets: { flexDirection: 'row', gap: 18, marginTop: 8 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 10 },
  progress: { fontSize: 13, marginTop: 10 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
});

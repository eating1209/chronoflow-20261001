import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../../context/AppContext';

const COMMON_STEPS = [
  '悬浮窗 / 显示在其他应用上层：允许',
  '使用情况访问：允许（用来判断你在桌面还是其他 App）',
  '通知：允许；锁屏通知设为“显示”',
];

const BRAND_STEPS = [
  {
    name: 'vivo / iQOO',
    steps: [
      '悬浮窗：设置 → 应用与权限 → 权限管理 → 悬浮窗 → 时纪流 → 允许',
      '后台：设置 → 电池 → 后台耗电管理 → 时纪流 → 允许后台高耗电',
      '若提示“部分功能已被限制”：设置 → 应用 → 应用管理 → 时纪流 → 右上角 ⋮ → 解除应用限制',
    ],
  },
  {
    name: '小米 / Redmi',
    steps: [
      '悬浮窗：设置 → 应用设置 → 应用管理 → 时纪流 → 权限管理 → 显示悬浮窗 → 允许',
      '后台：省电策略 → 无限制；自启动 → 允许',
    ],
  },
  {
    name: '华为 / 荣耀',
    steps: [
      '悬浮窗：设置 → 应用和服务 → 应用管理 → 时纪流 → 权限 → 悬浮窗 → 允许',
      '后台：设置 → 电池 → 启动管理 → 时纪流 → 手动管理 → 三项都打开',
    ],
  },
  {
    name: 'OPPO / 一加 / realme',
    steps: [
      '悬浮窗：设置 → 应用 → 应用管理 → 时纪流 → 权限管理 → 悬浮窗 → 允许',
      '后台：设置 → 电池 → 应用耗电管理 → 时纪流 → 允许后台运行；自启动 → 允许',
    ],
  },
];

/** 任务条权限的图文说明；入口在「我的 → 支持」和悬浮窗授权弹窗里。 */
export function PermissionHelpModal({
  visible,
  onClose,
  onOpenOverlaySettings,
  onOpenUsageSettings,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenOverlaySettings: () => void;
  onOpenUsageSettings: () => void;
}) {
  const theme = useAppTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.color.surface }]}>
          <Text style={[styles.title, { color: theme.color.textPrimary }]}>任务条开启帮助</Text>
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.intro, { color: theme.color.textSecondary }]}>
              不同品牌叫法不一样，通常要开三处：
            </Text>
            {COMMON_STEPS.map((step) => (
              <Text key={step} style={[styles.item, { color: theme.color.textPrimary }]}>
                · {step}
              </Text>
            ))}

            {BRAND_STEPS.map((brand) => (
              <View key={brand.name} style={styles.brand}>
                <Text style={[styles.brandName, { color: theme.color.textPrimary }]}>
                  {brand.name}
                </Text>
                {brand.steps.map((step) => (
                  <Text
                    key={step}
                    style={[styles.brandStep, { color: theme.color.textSecondary }]}
                  >
                    · {step}
                  </Text>
                ))}
              </View>
            ))}

            <Text style={[styles.footnote, { color: theme.color.textTertiary }]}>
              系统版本不同，菜单名可能略有差异；找不到时在设置里搜“悬浮窗”或“使用情况”。
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开悬浮窗设置"
              hitSlop={8}
              onPress={onOpenOverlaySettings}
            >
              <Text style={{ color: theme.color.accent, fontSize: 14, fontWeight: '600' }}>
                悬浮窗设置
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开使用情况设置"
              hitSlop={8}
              onPress={onOpenUsageSettings}
            >
              <Text style={{ color: theme.color.accent, fontSize: 14, fontWeight: '600' }}>
                使用情况设置
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭帮助"
              hitSlop={8}
              onPress={onClose}
            >
              <Text style={{ color: theme.color.textSecondary, fontSize: 14 }}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 48,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: {
    maxHeight: '100%',
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
  },
  title: { fontSize: 19, fontWeight: '600' },
  body: { marginTop: 10 },
  intro: { fontSize: 13, lineHeight: 19, marginBottom: 6 },
  item: { fontSize: 13, lineHeight: 20 },
  brand: { marginTop: 14 },
  brandName: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  brandStep: { fontSize: 12.5, lineHeight: 19 },
  footnote: { fontSize: 12, lineHeight: 18, marginTop: 14 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
});

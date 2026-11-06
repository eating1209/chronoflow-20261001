import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../context/AppContext';
import { subscribeToast, type ToastMessage } from './toastBus';

/**
 * 全局成功提示。挂在导航树外层，页面返回后仍能显示完。
 *
 * <p>不用 `Alert`：这里只是确认「刚刚那一下生效了」，不该再要求用户点一次确定。
 */
export function ToastHost() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => subscribeToast(setToast), []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    opacity.stopAnimation();
    translateY.stopAnimation();
    opacity.setValue(0);
    translateY.setValue(8);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 8, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) {
          setToast((current) => (current?.id === toast.id ? null : current));
        }
      });
    }, toast.durationMs);

    return () => clearTimeout(timer);
  }, [opacity, toast, translateY]);

  if (!toast) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.host,
        {
          bottom: insets.bottom + 84,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Animated.View
        style={[
          styles.bubble,
          {
            backgroundColor: theme.color.textPrimary,
            borderRadius: theme.radius.button,
          },
        ]}
      >
        <Text style={[styles.text, { color: theme.color.bg }]}>{toast.message}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

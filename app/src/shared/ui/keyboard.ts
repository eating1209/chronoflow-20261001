import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type ScrollView } from 'react-native';

/**
 * 编辑页的键盘避让。
 *
 * <p>Android 开了 edge-to-edge 后，`adjustResize` 在部分机型（尤其华为 / OPPO）不再
 * 可靠地把窗口缩短，底部备注框会被输入法直接盖住。这里不赌系统行为：
 * 读取当前键盘高度，给 ScrollView 的底部补同样高的可滚动空间；用户点到备注 /
 * 详细地址时再滚到底，保证光标和输入框都在键盘上方。
 */
export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    // 等键盘动画与底部 padding 生效后再滚，否则会停在还差一截的位置。
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 350);
  }, []);

  return { scrollRef, keyboardHeight, scrollToEnd };
}

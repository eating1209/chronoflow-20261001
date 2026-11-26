import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import {
  ensurePermission,
  permissionRationale,
  type PermissionKind,
  type PermissionGateway,
} from './permissions';
import { localNotificationsAvailable } from './notifications/availability';

/**
 * 权限申请的 RN 适配层：把 shared/permissions.ts 的纯逻辑接到真实的系统弹窗上。
 *
 * 所有申请相机 / 相册 / 定位的地方都必须走这里，**不要再直接调
 * `ImagePicker.requestCameraPermissionsAsync()`**——那样就绕过了「先说明用途」这一步，
 * 而审核规范把「未及时明确告知索取权限的目的和用途」列为常见违规。
 */
export async function askPermission(
  kind: PermissionKind,
  options: { quiet?: boolean } = {},
): Promise<boolean> {
  const rationale = permissionRationale(kind);

  const explain = () =>
    new Promise<boolean>((resolve) => {
      Alert.alert(rationale.title, rationale.message, [
        { text: '不允许', style: 'cancel', onPress: () => resolve(false) },
        { text: '继续', onPress: () => resolve(true) },
      ]);
    });

  const reject = () => {
    // 拒绝后只提示，绝不退出 App，也不再反复弹窗（规范 §四「不给权限 APP 弹窗循环」）
    Alert.alert('未开启权限', rationale.deniedHint, [
      { text: '知道了', style: 'cancel' },
      // 已经被系统记住「不再询问」时，唯一的补救路径是去系统设置，主动给一个入口
      { text: '去设置', onPress: () => void Linking.openSettings() },
    ]);
  };

  const gateway = gatewayFor(kind, explain, reject);
  if (options.quiet && !(await gateway.current())) {
    // 「静默尝试」场景（比如刚进地点选择页时顺手定位一下）：
    // 没授权就直接放弃，不弹任何窗——进来就弹一个权限说明正是「频繁弹窗」的典型形态
    return false;
  }
  return ensurePermission(gateway);
}

function gatewayFor(
  kind: PermissionKind,
  explain: () => Promise<boolean>,
  reject: () => void,
): PermissionGateway {
  if (kind === 'location') {
    return {
      current: async () => (await Location.getForegroundPermissionsAsync()).granted,
      request: async () => (await Location.requestForegroundPermissionsAsync()).granted,
      explain,
      reject,
    };
  }
  if (kind === 'notification') {
    /**
     * 通知走动态 import：原生通知模块在「Web 预览 / 缺原生模块的构建」里不存在，
     * 顶层 import 会让整个 App 起不来（与 modules/notifications/expoGateway.ts 同一套写法）。
     */
    if (!localNotificationsAvailable()) {
      // Expo Go（Android）：import 就会抛，这里直接当作「没有权限」，由调用方提示
      return {
        current: async () => false,
        request: async () => false,
        explain,
        reject,
      };
    }
    const api = () => import('expo-notifications');
    return {
      current: async () => (await (await api()).getPermissionsAsync()).granted,
      request: async () => (await (await api()).requestPermissionsAsync()).granted,
      explain,
      reject,
    };
  }
  if (kind === 'calendar') {
    /**
     * 系统日历是 Android 的运行时权限，读写必须一起拿到：
     * 读用来找到可写日历，写用来插入 / 更新 / 删除我们自己导出的那几条。
     * iOS 的系统日历要走 EventKit，不在这一版范围内；这里如实返回 false。
     */
    if (Platform.OS !== 'android') {
      return {
        current: async () => false,
        request: async () => false,
        explain,
        reject,
      };
    }
    const read = 'android.permission.READ_CALENDAR';
    const write = 'android.permission.WRITE_CALENDAR';
    return {
      current: async () => (
        (await PermissionsAndroid.check(read)) && (await PermissionsAndroid.check(write))
      ),
      request: async () => {
        const result = await PermissionsAndroid.requestMultiple([read, write]);
        return result[read] === PermissionsAndroid.RESULTS.GRANTED
          && result[write] === PermissionsAndroid.RESULTS.GRANTED;
      },
      explain,
      reject,
    };
  }
  if (kind === 'microphone') {
    /**
     * Android 直接用框架的 PermissionsAndroid：录音权限就是 `RECORD_AUDIO`，
     * 不需要为「申请权限」再引一个库。iOS 走 expo-audio 的 CoreAudio 权限。
     *
     * <p>两者都**动态 import / 只取框架 API**：Web 预览与缺原生模块的构建里，
     * 这一段最多返回 false，不会让整个 App 起不来。
     */
    if (Platform.OS === 'android') {
      const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
      return {
        current: async () => PermissionsAndroid.check(permission),
        request: async () => (
          await PermissionsAndroid.request(permission)
        ) === PermissionsAndroid.RESULTS.GRANTED,
        explain,
        reject,
      };
    }
    /**
     * expo-audio 的权限接口只在这一个分支用到，用**结构类型**声明它的形状：
     * 这个包在不同 SDK 小版本里导出名有变化（`AudioModule` / 顶层函数），
     * 写死具体名字会让 typecheck 跟着依赖升级一起碎；这里取不到就如实当作「没有权限」。
     */
    type AudioPermissionApi = {
      AudioModule?: {
        getRecordingPermissionsAsync?: () => Promise<{ granted: boolean }>;
        requestRecordingPermissionsAsync?: () => Promise<{ granted: boolean }>;
      };
    };
    const api = async () => (await import('expo-audio')) as unknown as AudioPermissionApi;
    return {
      current: async () => {
        try {
          const module = await api();
          return (await module.AudioModule?.getRecordingPermissionsAsync?.())?.granted ?? false;
        } catch {
          return false;
        }
      },
      request: async () => {
        try {
          const module = await api();
          return (await module.AudioModule?.requestRecordingPermissionsAsync?.())?.granted ?? false;
        } catch {
          return false;
        }
      },
      explain,
      reject,
    };
  }
  if (kind === 'camera') {
    // 相机的申请入口在 expo-image-picker 里（与相册同一个模块），别再去引第二个库
    return {
      current: async () => (await ImagePicker.getCameraPermissionsAsync()).granted,
      request: async () => (await ImagePicker.requestCameraPermissionsAsync()).granted,
      explain,
      reject,
    };
  }
  return {
    current: async () => (await ImagePicker.getMediaLibraryPermissionsAsync()).granted,
    request: async () => (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted,
    explain,
    reject,
  };
}

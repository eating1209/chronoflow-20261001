const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * 系统分享图片到「时纪流」。
 *
 * <p>在 Android 分享面板里注册一个只接收图片的轻量 Activity。它不改 MainActivity：
 * 收下图片后复制到 App 缓存，再把已有界面拉到前台，JS 继续走日历页现有的
 * OCR → 云端解析 → 确认页链路。`app/android/` 是 Expo prebuild 产物，所以
 * 源码、Manifest 都必须在插件里注入。
 */
const JAVA_PACKAGE = 'com.chronoflow.frontend';
const SOURCE_ROOT = path.join(__dirname, 'share-native');
const ACTIVITY_NAME = `${JAVA_PACKAGE}.ShareReceiverActivity`;

function action(name) {
  return { $: { 'android:name': name } };
}

function category(name) {
  return { $: { 'android:name': name } };
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function shareFilter() {
  return {
    $: { 'android:label': '时纪流' },
    action: [action('android.intent.action.SEND')],
    category: [category('android.intent.category.DEFAULT')],
    data: [{ $: { 'android:mimeType': 'image/*' } }],
  };
}

function injectShareManifest(manifest) {
  const application = manifest.application?.[0];
  if (!application) {
    return manifest;
  }

  const activities = application.activity ?? [];
  let receiver = activities.find((item) => {
    const name = item.$?.['android:name'];
    return name === ACTIVITY_NAME || name === '.ShareReceiverActivity';
  });

  if (!receiver) {
    receiver = {
      $: {
        'android:name': ACTIVITY_NAME,
        'android:label': '@string/app_name',
        'android:exported': 'true',
        'android:excludeFromRecents': 'true',
        'android:noHistory': 'true',
        'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
      },
      'intent-filter': [shareFilter()],
    };
    activities.push(receiver);
  } else {
    const filters = asArray(receiver['intent-filter']);
    const hasImageShare = filters.some((filter) =>
      asArray(filter.action).some(
        (item) => item.$?.['android:name'] === 'android.intent.action.SEND',
      ) &&
      asArray(filter.data).some(
        (item) => item.$?.['android:mimeType'] === 'image/*',
      ),
    );
    if (!hasImageShare) {
      filters.push(shareFilter());
    }
    receiver['intent-filter'] = filters;
  }

  application.activity = activities;
  return manifest;
}

module.exports = function withShareImageImport(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot;
      const javaRoot = path.join(
        projectRoot,
        'app',
        'src',
        'main',
        'java',
        ...JAVA_PACKAGE.split('.'),
      );
      fs.mkdirSync(javaRoot, { recursive: true });
      for (const name of fs.readdirSync(SOURCE_ROOT).filter((entry) => entry.endsWith('.kt'))) {
        fs.copyFileSync(path.join(SOURCE_ROOT, name), path.join(javaRoot, name));
      }
      return cfg;
    },
  ]);

  return withAndroidManifest(config, (cfg) => {
    injectShareManifest(cfg.modResults.manifest);
    return cfg;
  });
};

module.exports.injectShareManifest = injectShareManifest;

const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * 任务栏 / 锁屏常驻任务总览（Android）。
 *
 * <p>`app/android/` 是 Expo prebuild 的产物并被仓库忽略，所以原生模块、通知布局和图标
 * 必须由插件写入，不能只手工放进去。这里复制 `plugins/taskbar-native/` 下的源码，
 * 再把 Package 注册进 MainApplication。
 *
 * <p>通知本身仍是普通 ongoing notification + PUBLIC visibility；顶部小条是独立开关，
 * 只有用户主动授权 SYSTEM_ALERT_WINDOW 后才会启动 overlay 服务。
 */
const JAVA_PACKAGE = 'com.chronoflow.frontend';
const SOURCE_ROOT = path.join(__dirname, 'taskbar-native');
const REQUIRED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.GET_TASKS',
  'android.permission.PACKAGE_USAGE_STATS',
  // expo-notifications 的 AAR 清单正常由 Gradle 合并进来；这里再声明一次，
  // 避免手工重建清单时漏掉通知权限，导致开关点了没反应。
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // 系统日历单向导出（CalendarSyncModule）：读用来找可写日历，写用来维护我们自己的条目。
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
];

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function injectTaskBarPackage(contents) {
  let next = contents;
  if (!next.includes(`import ${JAVA_PACKAGE}.TaskBarNotificationPackage`)) {
    next = next.replace(
      /^(import expo\.modules\.ExpoReactHostFactory)$/m,
      `$1\nimport ${JAVA_PACKAGE}.TaskBarNotificationPackage`,
    );
  }
  if (!next.includes('add(TaskBarNotificationPackage())')) {
    next = next.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      'PackageList(this).packages.apply {\n          add(TaskBarNotificationPackage()) // [withTaskBarNotification] 手工注册',
    );
  }
  return next;
}

function injectTaskBarManifest(manifest) {
  const permissions = manifest['uses-permission'] ?? [];
  for (const name of REQUIRED_PERMISSIONS) {
    const existing = permissions.find((item) => item.$?.['android:name'] === name);
    if (existing) {
      // app.json 旧版本曾用 tools:node="remove" 屏蔽悬浮窗；这里以插件声明为准。
      delete existing.$['tools:node'];
      if (!existing.$['android:name']) {
        existing.$['android:name'] = name;
      }
    } else {
      permissions.push({ $: { 'android:name': name } });
    }
  }
  manifest['uses-permission'] = permissions;

  // Android 11+ 默认隐藏其它应用。任务条要判断当前是不是桌面，必须显式声明
  // 可以查询 HOME Activity；否则部分 ROM 只返回解析器，随后把真正的桌面误判成
  // “其他应用”，表现为桌面上仍显示细条。
  const queries = manifest.queries ?? [];
  const query = queries[0] ?? {};
  const intents = query.intent ?? [];
  const hasHomeQuery = intents.some((intent) => {
    const actions = intent.action ?? [];
    const categories = intent.category ?? [];
    return (
      actions.some((item) => item.$?.['android:name'] === 'android.intent.action.MAIN') &&
      categories.some(
        (item) => item.$?.['android:name'] === 'android.intent.category.HOME',
      )
    );
  });
  if (!hasHomeQuery) {
    intents.push({
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.HOME' } }],
    });
  }
  query.intent = intents;
  if (queries.length === 0) {
    queries.push(query);
  }
  manifest.queries = queries;

  const application = manifest.application?.[0];
  if (!application) {
    return manifest;
  }

  const receivers = application.receiver ?? [];
  if (!receivers.some((item) => item.$?.['android:name'] === `${JAVA_PACKAGE}.TaskBarActionReceiver`)) {
    receivers.push({
      $: {
        'android:name': `${JAVA_PACKAGE}.TaskBarActionReceiver`,
        'android:exported': 'false',
      },
    });
  }
  application.receiver = receivers;

  const services = application.service ?? [];
  if (!services.some((item) => item.$?.['android:name'] === `${JAVA_PACKAGE}.TaskBarOverlayService`)) {
    services.push({
      $: {
        'android:name': `${JAVA_PACKAGE}.TaskBarOverlayService`,
        'android:exported': 'false',
        'android:foregroundServiceType': 'specialUse',
      },
      property: [
        {
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': 'persistent taskbar overlay',
          },
        },
      ],
    });
  }
  application.service = services;
  return manifest;
}

module.exports = function withTaskBarNotification(config) {
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
      for (const name of fs
        .readdirSync(SOURCE_ROOT)
        .filter((entry) => entry.endsWith('.kt'))) {
        fs.copyFileSync(path.join(SOURCE_ROOT, name), path.join(javaRoot, name));
      }
      copyTree(
        path.join(SOURCE_ROOT, 'res'),
        path.join(projectRoot, 'app', 'src', 'main', 'res'),
      );
      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    cfg.modResults.contents = injectTaskBarPackage(cfg.modResults.contents);
    return cfg;
  });

  // 通知卡上的点击由广播接收器处理，必须在 Manifest 里声明；exported=false 只允许本 App
  // 自己创建的 PendingIntent 触发，不暴露给其它应用。
  return withAndroidManifest(config, (cfg) => {
    injectTaskBarManifest(cfg.modResults.manifest);
    return cfg;
  });
};

module.exports.injectTaskBarPackage = injectTaskBarPackage;
module.exports.injectTaskBarManifest = injectTaskBarManifest;

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const requirePlugin = createRequire(import.meta.url);
const { injectTaskBarPackage, injectTaskBarManifest } = requirePlugin(
  '../plugins/withTaskBarNotification',
) as {
  injectTaskBarPackage: (contents: string) => string;
  injectTaskBarManifest: (manifest: Record<string, unknown>) => Record<string, unknown>;
};

const TEMPLATE = `
import expo.modules.ExpoReactHostFactory

class MainApplication {
  val packages = PackageList(this).packages.apply {
  }
}
`;

describe('任务栏通知原生注册（withTaskBarNotification）', () => {
  it('补 import 并注册 Package', () => {
    const output = injectTaskBarPackage(TEMPLATE);
    expect(output).toContain('import com.chronoflow.frontend.TaskBarNotificationPackage');
    expect(output).toContain('add(TaskBarNotificationPackage())');
  });

  it('重复执行不会注册两次（prebuild 多次也安全）', () => {
    const once = injectTaskBarPackage(TEMPLATE);
    expect(injectTaskBarPackage(once)).toBe(once);
  });

  it('只有 import、没有注册时也会补上 Package', () => {
    const importedOnly = TEMPLATE.replace(
      'import expo.modules.ExpoReactHostFactory',
      'import expo.modules.ExpoReactHostFactory\nimport com.chronoflow.frontend.TaskBarNotificationPackage',
    );
    const output = injectTaskBarPackage(importedOnly);
    expect(output).toContain('add(TaskBarNotificationPackage())');
  });
});

describe('顶部任务小条 Manifest 注入', () => {
  it('保留悬浮窗权限并声明特殊用途前台服务', () => {
    const manifest = injectTaskBarManifest({
      'uses-permission': [
        {
          $: {
            'android:name': 'android.permission.SYSTEM_ALERT_WINDOW',
            'tools:node': 'remove',
          },
        },
      ],
      application: [{}],
    });

    const permissions = manifest['uses-permission'] as Array<{
      $: Record<string, string>;
    }>;
    const systemAlert = permissions.find(
      (item) => item.$['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW',
    );
    expect(systemAlert?.$['tools:node']).toBeUndefined();
    expect(permissions.map((item) => item.$['android:name'])).toEqual(
      expect.arrayContaining([
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      ]),
    );

    const application = (manifest.application as Array<Record<string, unknown>>)[0];
    const services = application.service as Array<{
      $: Record<string, string>;
      property?: Array<{ $: Record<string, string> }>;
    }>;
    const overlay = services.find(
      (item) => item.$['android:name'] === 'com.chronoflow.frontend.TaskBarOverlayService',
    );
    expect(overlay?.$['android:foregroundServiceType']).toBe('specialUse');
    expect(overlay?.property?.[0]?.$['android:name']).toBe(
      'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
    );
  });

  it('重复注入不会重复声明', () => {
    const once = injectTaskBarManifest({ application: [{}] });
    const twice = injectTaskBarManifest(once);
    const application = (twice.application as Array<Record<string, unknown>>)[0];
    expect(
      (application.service as Array<{ $: Record<string, string> }>).filter(
        (item) =>
          item.$['android:name'] === 'com.chronoflow.frontend.TaskBarOverlayService',
      ),
    ).toHaveLength(1);
  });
});

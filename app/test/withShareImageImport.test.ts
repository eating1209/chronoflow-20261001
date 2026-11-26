import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const requirePlugin = createRequire(import.meta.url);
const { injectShareManifest } = requirePlugin('../plugins/withShareImageImport') as {
  injectShareManifest: (manifest: Record<string, unknown>) => Record<string, unknown>;
};

describe('系统分享图片 Manifest（withShareImageImport）', () => {
  it('注册只接收 image/* 的 SEND Activity', () => {
    const manifest = injectShareManifest({ application: [{}] });
    const application = (manifest.application as Array<Record<string, unknown>>)[0];
    const activity = (application.activity as Array<{
      $: Record<string, string>;
      'intent-filter': Array<{
        action: Array<{ $: Record<string, string> }>;
        data: Array<{ $: Record<string, string> }>;
      }>;
    }>)[0];

    expect(activity.$['android:name']).toBe(
      'com.chronoflow.frontend.ShareReceiverActivity',
    );
    expect(activity.$['android:exported']).toBe('true');
    expect(activity['intent-filter'][0].action[0].$['android:name']).toBe(
      'android.intent.action.SEND',
    );
    expect(activity['intent-filter'][0].data[0].$['android:mimeType']).toBe('image/*');
  });

  it('重复注入不会重复声明', () => {
    const once = injectShareManifest({ application: [{}] });
    const twice = injectShareManifest(once);
    const application = (twice.application as Array<Record<string, unknown>>)[0];

    expect(
      (application.activity as Array<{ $: Record<string, string> }>).filter(
        (item) => item.$['android:name'] === 'com.chronoflow.frontend.ShareReceiverActivity',
      ),
    ).toHaveLength(1);
  });
});

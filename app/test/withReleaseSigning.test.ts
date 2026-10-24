import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const requirePlugin = createRequire(import.meta.url);
const { injectReleaseSigning } = requirePlugin('../plugins/withReleaseSigning') as {
  injectReleaseSigning: (contents: string) => string;
};

const TEMPLATE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('正式签名注入（withReleaseSigning）', () => {
  afterEach(() => {
    delete process.env.CHRONOFLOW_KEYSTORE;
    delete process.env.CHRONOFLOW_KEYSTORE_PASSWORD;
    delete process.env.CHRONOFLOW_KEY_ALIAS;
    delete process.env.CHRONOFLOW_KEY_PASSWORD;
    delete process.env.CHRONOFLOW_REQUIRE_RELEASE_SIGNING;
  });

  it('注入后 release 用正式签名，debug 仍是 debug', () => {
    const out = injectReleaseSigning(TEMPLATE);

    expect(out).toContain('System.getenv("CHRONOFLOW_KEYSTORE")');
    expect(out).toMatch(/release \{[\s\S]*?signingConfig signingConfigs\.release/);
    expect(out.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1);
    // 口令只能来自环境变量，不能把明文写进 build.gradle
    expect(out).not.toMatch(/storePassword\s+['"]/);
  });

  it('重复执行不会写第二遍（prebuild 多次也不坏）', () => {
    const once = injectReleaseSigning(TEMPLATE);
    expect(injectReleaseSigning(once)).toBe(once);
  });

  it('模板结构变了会抛错，而不是静默出一个 debug 签名的包', () => {
    expect(() => injectReleaseSigning('android { }')).toThrow(/signingConfigs/);
  });
});

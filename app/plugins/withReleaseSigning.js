const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * 把「正式签名」注入 `android/app/build.gradle`。
 *
 * <p>为什么必须是插件：`expo prebuild` 每次都会**重建** `android/`，手工改的 `signingConfigs`
 * 会被冲掉；冲掉之后模板默认还是 `signingConfigs.debug`，于是又出一个「release 构建 +
 * debug 签名」的包——上不了架，别人还能伪造同名更新包覆盖安装。
 *
 * <p>口令与密钥路径都从**环境变量**读，不写进 build.gradle、不进仓库：
 *
 * ```
 * CHRONOFLOW_KEYSTORE            ~/keys/chronoflow-release.jks（绝对路径）
 * CHRONOFLOW_KEYSTORE_PASSWORD   keystore 口令
 * CHRONOFLOW_KEY_ALIAS           chronoflow
 * CHRONOFLOW_KEY_PASSWORD        密钥口令
 * ```
 *
 * <p>四个变量没齐时：默认只警告、保留 debug 签名（方便本地 debug 构建）；
 * 但 `build_apk.sh --release` 会导出 `CHRONOFLOW_REQUIRE_RELEASE_SIGNING=1`，
 * 这时**直接抛错**，绝不悄悄出一个 debug 签名的上架包。
 */
const REQUIRED_ENV = [
  'CHRONOFLOW_KEYSTORE',
  'CHRONOFLOW_KEYSTORE_PASSWORD',
  'CHRONOFLOW_KEY_ALIAS',
  'CHRONOFLOW_KEY_PASSWORD',
];

const RELEASE_SIGNING_CONFIG = `
        release {
            // 正式签名：路径与口令都来自环境变量，密钥文件与口令都不落盘、不进仓库
            storeFile file(System.getenv("CHRONOFLOW_KEYSTORE"))
            storePassword System.getenv("CHRONOFLOW_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CHRONOFLOW_KEY_ALIAS")
            keyPassword System.getenv("CHRONOFLOW_KEY_PASSWORD")
        }`;

/** 纯函数：把正式签名写进 build.gradle 文本。抽出来是为了能脱离 expo 单测。 */
function injectReleaseSigning(contents) {
    if (contents.includes('signingConfigs.release')) {
      // 已经注入过（重复 prebuild / 模板自带），保持幂等
      return contents;
    }
    if (!/signingConfigs\s*\{/.test(contents)) {
      throw new Error('[withReleaseSigning] build.gradle 里没有 signingConfigs 块，模板结构变了');
    }
    contents = contents.replace(/signingConfigs\s*\{/, (matched) => `${matched}${RELEASE_SIGNING_CONFIG}`);

    const buildTypesAt = contents.indexOf('buildTypes');
    if (buildTypesAt < 0) {
      throw new Error('[withReleaseSigning] build.gradle 里没有 buildTypes 块，模板结构变了');
    }
    const head = contents.slice(0, buildTypesAt);
    const tail = contents.slice(buildTypesAt);
    const patched = tail.replace(
      /(release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );
    if (patched === tail) {
      throw new Error('[withReleaseSigning] 没找到 release 的 debug 签名行，模板结构变了');
    }

    return head + patched;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      const message = `[withReleaseSigning] 缺少签名环境变量：${missing.join(', ')}`;
      if (process.env.CHRONOFLOW_REQUIRE_RELEASE_SIGNING === '1') {
        throw new Error(
          `${message}\n  上架包必须用正式签名，步骤见 docs/04-运维/DEPLOY.md「正式签名」。`,
        );
      }
      console.warn(`${message}（未要求正式签名，release 仍用 debug 签名，仅限本地调试）`);
      return cfg;
    }
    cfg.modResults.contents = injectReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.injectReleaseSigning = injectReleaseSigning;

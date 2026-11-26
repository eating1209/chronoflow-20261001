/**
 * 隐藏「测试更新」的纯数据规则。
 *
 * <p>这里只做地址归一化，不碰 SecureStore / 原生安装器：
 * 地址是开发配置，不能在正式发布信息里出现，也不该把测试包推给线上用户。
 */

/**
 * 固定的测试包地址：每次发布覆盖同一个文件，手机端不用改地址。
 * 线上发布信息仍是正式版本，其他用户不会看到这个包。
 *
 * <p>`direct` 绕过备案域名的反向代理，通常快很多；`domain` 在直连被网络
 * 限制时兜底。两条线路指向同一个文件。
 */
export const TEST_UPDATE_URLS = {
  direct: 'http://60.205.142.205:8080/downloads/chronoflow-test.apk',
  domain: 'https://chronocloud.top/downloads/chronoflow-test.apk',
} as const;

/** 默认走直连；慢或打不开时在弹窗里切到域名线路。 */
export const DEFAULT_TEST_UPDATE_URL = TEST_UPDATE_URLS.direct;

/** 测试更新只接受 http(s) 直链；空串、相对路径、ftp 都当无效。 */
export function normalizeTestUpdateUrl(raw: string): string | null {
  const value = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(value)) {
    return null;
  }
  return value;
}

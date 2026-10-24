#!/usr/bin/env bash
#
# 上架版一条龙：部署后端 → 出 APK → 发布 APK → 更新服务器发布配置 → 验收。
#
# 用法（在仓库根目录执行）：
#   bash scripts/release_listing.sh
#
# 可选参数：
#   --skip-backend   只出包 / 发布，不重新部署后端
#   --skip-apk       只部署后端，不出包（已经出好包时用）
#
# 可覆盖的环境变量：
#   CHRONOFLOW_VERSION_NAME / CHRONOFLOW_VERSION_CODE / CHRONOFLOW_CHANGELOG
#   CHRONOFLOW_ARCHS                  默认 arm64-v8a,x86_64
#   CHRONOFLOW_PUBLIC_BASE            默认 https://chronocloud.top
#
# 版本号默认从 app/app.json 读，不要在脚本里另写一份。
# 预计耗时：出包 10–20 分钟（Gradle 编原生库），期间没有输出是正常的，别中断。
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_JSON="$ROOT/app/app.json"
PUBLIC_BASE="${CHRONOFLOW_PUBLIC_BASE:-https://chronocloud.top}"
ARCHS="${CHRONOFLOW_ARCHS:-arm64-v8a,x86_64}"

SKIP_BACKEND=0
SKIP_APK=0
for arg in "$@"; do
  case "$arg" in
    --skip-backend) SKIP_BACKEND=1 ;;
    --skip-apk) SKIP_APK=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

[ -f "$APP_JSON" ] || { echo "✗ 找不到 $APP_JSON" >&2; exit 1; }
VERSION_NAME="${CHRONOFLOW_VERSION_NAME:-$(node -p "require('$APP_JSON').expo.version")}"
VERSION_CODE="${CHRONOFLOW_VERSION_CODE:-$(node -p "require('$APP_JSON').expo.android.versionCode")}"
CHANGELOG="${CHRONOFLOW_CHANGELOG:-上架版本 $VERSION_NAME：合规文本更新、接入备案域名、版本号更新}"
API_BASE="$(node -p "require('$APP_JSON').expo.extra.apiBaseUrl")"

echo "============================================================"
echo " 时纪流上架发布"
echo " 版本：$VERSION_NAME ($VERSION_CODE)"
echo " API ：$API_BASE"
echo " 对外：$PUBLIC_BASE"
echo "============================================================"

if [ "$API_BASE" != "$PUBLIC_BASE" ]; then
  echo "⚠ app.json 的 apiBaseUrl 是 $API_BASE，但这次对外地址是 $PUBLIC_BASE。" >&2
  echo "  上架包必须两者一致，否则隐私政策 / 接口 / 下载地址会对不上。" >&2
  exit 1
fi

for cmd in node npm ssh scp curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "✗ 缺少命令：$cmd" >&2; exit 1; }
done

DEPLOY_HOST="${CHRONOFLOW_DEPLOY_HOST:-root@60.205.142.205}"
DEPLOY_KEY="${CHRONOFLOW_DEPLOY_KEY:-$HOME/.ssh/60.205.142.205-北京.pem}"
echo "→ 检查 SSH 连接：$DEPLOY_HOST"
if ! ssh -i "$DEPLOY_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_HOST" true; then
  echo "✗ 连不上服务器。检查私钥路径（当前：$DEPLOY_KEY）与网络；" >&2
  echo "  也可以用 CHRONOFLOW_DEPLOY_KEY=... / CHRONOFLOW_DEPLOY_HOST=... 覆盖。" >&2
  exit 1
fi

if [ "$SKIP_BACKEND" = "0" ]; then
  echo
  echo "▶ 第 1 步 / 4：部署后端（重新打 jar + 重建容器）"
  bash "$ROOT/scripts/deploy_backend.sh"
else
  echo "▶ 跳过后端部署"
fi

APK="$ROOT/app/android/app/build/outputs/apk/release/app-release.apk"
if [ "$SKIP_APK" = "0" ]; then
  echo
  echo "▶ 第 2 步 / 4：出 release APK（10–20 分钟，别中断）"
  bash "$ROOT/scripts/build_apk.sh" --prebuild --release --archs="$ARCHS"
else
  echo "▶ 跳过出包，使用已有 APK"
fi
[ -f "$APK" ] || { echo "✗ 没有找到 APK：$APK" >&2; exit 1; }

echo
echo "▶ 第 3 步 / 4：上传 APK + 更新服务器 .env + 重启 backend"
CHRONOFLOW_PUBLIC_BASE="$PUBLIC_BASE" \
  bash "$ROOT/scripts/publish_apk.sh" "$APK" "$VERSION_NAME" "$VERSION_CODE" "$CHANGELOG" --write-env

echo
echo "▶ 第 4 步 / 4：最终验收"
fail=0
check_url() {
  local url="$1" expect="$2" label="$3" body=""
  body="$(curl -fsS --max-time 15 "$url" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -Eq "$expect"; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label（$url）" >&2
    printf '%s\n' "${body:0:200}" >&2
    fail=1
  fi
}
check_url "$PUBLIC_BASE/api/v1/legal/privacy-policy?v=$(date +%s)" "应用软件有限责任公司" "隐私政策：公司名"
check_url "$PUBLIC_BASE/api/v1/legal/privacy-policy?v=$(date +%s)" "法定代表人：陶伊婷" "隐私政策：法定代表人"
check_url "$PUBLIC_BASE/api/v1/system/app-release?v=$(date +%s)" "\"versionCode\"[[:space:]]*:[[:space:]]*$VERSION_CODE" "应用内更新：versionCode=$VERSION_CODE"
code="$(curl -s -o /dev/null -w '%{http_code}' -I --max-time 15 "$PUBLIC_BASE/downloads/chronoflow-$VERSION_NAME.apk" 2>/dev/null || true)"
if [ "$code" != "200" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -r 0-0 --max-time 15 "$PUBLIC_BASE/downloads/chronoflow-$VERSION_NAME.apk" 2>/dev/null || true)"
  [ "$code" = "206" ] && code="200"
fi
if [ "$code" = "200" ]; then
  echo "  ✓ 安装包下载：$PUBLIC_BASE/downloads/chronoflow-$VERSION_NAME.apk"
else
  echo "  ✗ 安装包下载返回 $code：$PUBLIC_BASE/downloads/chronoflow-$VERSION_NAME.apk" >&2
  fail=1
fi

echo
if [ "$fail" = "0" ]; then
  echo "✅ 全部通过。把 https://chronocloud.top/downloads/chronoflow-$VERSION_NAME.apk 填到应用宝。"
else
  echo "⚠ 有检查没通过。最常见的两个原因：" >&2
  echo "  1. 老服务器 8.136.20.182 的 nginx 还没把 /api、/downloads 反代到新后端（docs/04-运维/DEPLOY.md §2.1）；" >&2
  echo "  2. 域名缓存：换 ?v=时间戳 再试。" >&2
  exit 1
fi

cat <<'EOF'

还需要你在「App 备案」后台手工改（代码改不到）：
  1. 三方 SDK 的推送类改成「深圳市和讯华谷信息技术有限公司（极光推送）」；
  2. 功能描述删掉「系统日历同步」；
  3. 核对签名 MD5 与最终 APK 一致；
  4. 确认主体名称、法定代表人（陶伊婷）与营业执照一致。

详细清单：docs/02-合规/上架资质核对.md
EOF

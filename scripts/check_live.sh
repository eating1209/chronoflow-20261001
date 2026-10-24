#!/usr/bin/env bash
#
# 只读自检：一次看清「直连后端」和「备案域名」各自返回什么。
# 不写任何文件、不改服务器，随时可跑。
#
# 用法：
#   bash scripts/check_live.sh
#   CHRONOFLOW_VERSION_NAME=1.1.0 bash scripts/check_live.sh
#
set -uo pipefail

DIRECT="${CHRONOFLOW_DIRECT_BASE:-http://60.205.142.205:8080}"
DOMAIN="${CHRONOFLOW_PUBLIC_BASE:-https://chronocloud.top}"
VERSION_NAME="${CHRONOFLOW_VERSION_NAME:-1.1.0}"

say() { printf '%s\n' "$*"; }
hr() { printf '%s\n' '------------------------------------------------------------'; }

say "时纪流线上自检  $(date '+%Y-%m-%d %H:%M:%S %Z')"
hr
say "DNS："
if command -v getent >/dev/null 2>&1; then
  getent hosts "${DOMAIN#https://}" 2>/dev/null | sed 's/^/  /' || say "  （解析失败）"
else
  say "  （没有 getent，跳过）"
fi
hr

check() {
  local label="$1" url="$2" body code
  body="$(mktemp)"
  code="$(curl -sS -L --max-time 12 -o "$body" -w '%{http_code}' "$url" 2>/dev/null)" || code="ERR"
  printf '%-34s %s  %s\n' "$label" "$code" "$url"
  if [ -s "$body" ]; then
    if grep -q "应用软件开发有限公司" "$body"; then
      say "    ↳ 内容：旧公司名（带“开发”）"
    elif grep -q "舟山市时纪云人工智能应用软件有限责任公司" "$body"; then
      say "    ↳ 内容：新公司名"
    fi
    if grep -q "陈诗音" "$body"; then
      say "    ↳ 法定代表人：陈诗音（旧）"
    elif grep -q "陶伊婷" "$body"; then
      say "    ↳ 法定代表人：陶伊婷（新）"
    fi
    if grep -q '"versionCode"' "$body"; then
      grep -o '"versionCode"[[:space:]]*:[[:space:]]*[0-9]*' "$body" | head -1 | sed 's/^/    ↳ /'
    fi
    case "$code" in
      401) say "    ↳ 401 = 路由存在但要求登录（合规接口不应如此，检查是否打到了旧后端）" ;;
      404) say "    ↳ 404 = 这个地址没有对应资源（包没发布 / 路由没反代）" ;;
      502|503|504) say "    ↳ 网关错误（后端正在重启，或 nginx 反代目标不可达）" ;;
    esac
    if printf '%s' "$body" | head -c 200 | grep -q "Authentication required"; then
      say "    ↳ 返回体是 Authentication required（旧后端 / 需要登录）"
    fi
  fi
  rm -f "$body"
}


# 安装包有 80MB+，用 check() 会把整包下下来（12 秒超时 → 误报 ERR）。
# 这里只发 HEAD；HEAD 被拒再退化成「只取 1 字节」。
check_file() {
  local label="$1" url="$2" code
  code="$(curl -sS -o /dev/null -I --max-time 10 -w '%{http_code}' "$url" 2>/dev/null)" || code=""
  case "$code" in
    ""|000|403|405)
      code="$(curl -sS -o /dev/null -r 0-0 --max-time 10 -w '%{http_code}' "$url" 2>/dev/null)" || code="ERR"
      [ "$code" = "206" ] && code="200"
      ;;
  esac
  printf '%-34s %s  %s\n' "$label" "$code" "$url"
  case "$code" in
    200) ;;
    401) say "    ↳ 401 = 要求登录（下载地址不该这样，检查反代）" ;;
    404) say "    ↳ 404 = 包没发布 / 路由没反代" ;;
    000|ERR) say "    ↳ 连不上（超时或 DNS 失败）" ;;
    *) say "    ↳ 非预期状态码" ;;
  esac
}

say "直连后端：$DIRECT"
check "system/info" "$DIRECT/api/v1/system/info"
check "legal/privacy-policy" "$DIRECT/api/v1/legal/privacy-policy?v=$(date +%s)"
check "system/app-release" "$DIRECT/api/v1/system/app-release?v=$(date +%s)"
check_file "downloads/chronoflow-$VERSION_NAME.apk" "$DIRECT/downloads/chronoflow-$VERSION_NAME.apk"
hr

say "备案域名：$DOMAIN"
check "system/info" "$DOMAIN/api/v1/system/info"
check "legal/privacy-policy" "$DOMAIN/api/v1/legal/privacy-policy?v=$(date +%s)"
check "system/app-release" "$DOMAIN/api/v1/system/app-release?v=$(date +%s)"
check_file "downloads/chronoflow-$VERSION_NAME.apk" "$DOMAIN/downloads/chronoflow-$VERSION_NAME.apk"
hr

say "怎么读结果："
say "  · 直连正常、域名 401/404/旧文本 → 老服务器 nginx 没反代到新后端，见 docs/04-运维/DEPLOY.md §2.1"
say "  · 直连也是旧文本 → jar 没换，跑 bash scripts/deploy_backend.sh（上传前会检查 jar 内容）"
say "  · APK 404 → 还没发布，跑 bash scripts/release_listing.sh（或 publish_apk.sh --write-env）"

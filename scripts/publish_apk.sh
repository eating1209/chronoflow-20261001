#!/usr/bin/env bash
#
# 发布一个 Android 安装包到演示服务器，并可顺手更新服务器上的发布配置
# （spec §4.1.11「应用内更新」）。
#
# 用法：
#   scripts/publish_apk.sh <apk 路径> <版本名> <版本号> [更新说明] [--force] [--write-env]
#
#   例：scripts/publish_apk.sh app/android/app/build/outputs/apk/release/app-release.apk \
#          1.1.0 14 "上架版本" --write-env
#
# 它做四件事：
#   1. 把包传到 /opt/chronoflow/web/downloads/（nginx 的 /downloads/ 直接发）；
#   2. 算出字节数与 SHA-256；
#   3. 打印「贴进 .env 就行」的那九行；
#   4. 带 `--write-env` 时，自动备份并更新服务器 .env、重启 backend、验证
#      `/api/v1/system/app-release` 与下载地址。不写 .env 时只打印，不改服务器。
#
# 为什么默认不写 .env：那台机器上 .env 是唯一的事实来源（含真 Key）。
# 需要自动发布时显式加 --write-env，脚本会先做 `cp -a .env .env.bak.<时间>`。
#
set -euo pipefail

# 默认把 APK 传到**新环境**（2026-10-01 建，新标识那套），对外地址走备案域名
# https://chronocloud.top（老服务器只做 HTTPS 入口，反代 /downloads/ 到新环境）。
# 要把包传到老环境本地，覆盖 CHRONOFLOW_DEPLOY_HOST/CHRONOFLOW_DEPLOY_KEY，
# 并把 CHRONOFLOW_PUBLIC_BASE 改成老环境能访问的地址。
SSH_KEY="${CHRONOFLOW_DEPLOY_KEY:-$HOME/.ssh/60.205.142.205-北京.pem}"
SSH_HOST="${CHRONOFLOW_DEPLOY_HOST:-root@60.205.142.205}"
REMOTE_DIR="${CHRONOFLOW_DOWNLOAD_DIR:-/opt/chronoflow/web/downloads}"
COMPOSE_DIR="${CHRONOFLOW_REMOTE_COMPOSE_DIR:-/opt/chronoflow}"
PUBLIC_BASE="${CHRONOFLOW_PUBLIC_BASE:-https://chronocloud.top}"

APK="${1:-}"
VERSION_NAME="${2:-}"
VERSION_CODE="${3:-}"
CHANGELOG="${4:-}"
FORCE="false"
WRITE_ENV="false"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE="true" ;;
    --write-env) WRITE_ENV="true" ;;
  esac
done
case "$CHANGELOG" in
  --*) CHANGELOG="" ;;
esac

if [ -z "$APK" ] || [ -z "$VERSION_NAME" ] || [ -z "$VERSION_CODE" ]; then
  sed -n '2,22p' "$0"
  exit 2
fi
[ -f "$APK" ] || { echo "找不到安装包：$APK" >&2; exit 1; }
case "$VERSION_CODE" in (*[!0-9]*) echo "版本号必须是整数：$VERSION_CODE" >&2; exit 2;; esac

# 文件名要能自证身份：**产品名 + 版本名**。以前叫 `app-0.0.0.apk`，
# 下载下来一堆包根本分不清是哪个软件的哪一版（用户当场问过）。
FILE_NAME="${CHRONOFLOW_APK_NAME:-chronoflow-${VERSION_NAME}.apk}"
SIZE_BYTES=$(stat -c%s "$APK")
SHA256=$(sha256sum "$APK" | awk '{print $1}')
PUBLISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "→ 上传 $(basename "$APK") → $SSH_HOST:$REMOTE_DIR/$FILE_NAME（$((SIZE_BYTES / 1024 / 1024)) MB）"
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
scp -i "$SSH_KEY" "$APK" "$SSH_HOST:$REMOTE_DIR/$FILE_NAME"

# env_file 支持单引号；把值里的单引号转义掉，避免说明里带空格时被截断。
env_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

SNIPPET="$(mktemp)"
trap 'rm -f "$SNIPPET"' EXIT
{
  echo "CHRONOFLOW_APP_RELEASE_VERSION_NAME=$(env_quote "$VERSION_NAME")"
  echo "CHRONOFLOW_APP_RELEASE_VERSION_CODE=$VERSION_CODE"
  echo "CHRONOFLOW_APP_RELEASE_APK_URL=/downloads/$FILE_NAME"
  echo "CHRONOFLOW_APP_RELEASE_SIZE_BYTES=$SIZE_BYTES"
  echo "CHRONOFLOW_APP_RELEASE_SHA256=$SHA256"
  echo "CHRONOFLOW_APP_RELEASE_CHANGELOG=$(env_quote "$CHANGELOG")"
  echo "CHRONOFLOW_APP_RELEASE_FORCE=$FORCE"
  echo "CHRONOFLOW_APP_RELEASE_MIN_SUPPORTED_VERSION_CODE=0"
  echo "CHRONOFLOW_APP_RELEASE_PUBLISHED_AT=$PUBLISHED_AT"
} > "$SNIPPET"

if [ "$WRITE_ENV" = "true" ]; then
  REMOTE_TMP="/tmp/chronoflow-app-release.$$.env"
  echo "→ 更新 $SSH_HOST:$COMPOSE_DIR/.env（先备份），然后重启 backend"
  scp -i "$SSH_KEY" "$SNIPPET" "$SSH_HOST:$REMOTE_TMP"
  ssh -i "$SSH_KEY" "$SSH_HOST" bash -s -- "$COMPOSE_DIR" "$REMOTE_TMP" <<'REMOTE'
set -euo pipefail
compose_dir="$1"
snippet="$2"
cd "$compose_dir"
[ -f .env ] || { echo "✗ $compose_dir/.env 不存在" >&2; exit 1; }
backup=".env.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp -a .env "$backup"
mode="$(stat -c %a .env)"
grep -v '^CHRONOFLOW_APP_RELEASE_' .env > .env.new || true
cat "$snippet" >> .env.new
chmod "$mode" .env.new
mv .env.new .env
rm -f "$snippet"
echo "  备份：$compose_dir/$backup"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d backend
else
  docker-compose up -d backend
fi
REMOTE

  echo "→ 等待后端重启并验证发布信息（最多 150 秒）"
  ok=0
  for _ in $(seq 1 50); do
    sleep 3
    body="$(curl -fsS --max-time 8 "$PUBLIC_BASE/api/v1/system/app-release?v=$(date +%s)" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -qE "\"versionCode\"[[:space:]]*:[[:space:]]*$VERSION_CODE([^0-9]|$)"; then
      ok=1
      printf '%s\n' "$body"
      break
    fi
  done
  if [ "$ok" != "1" ]; then
    echo "⚠ 发布信息还没返回 versionCode=$VERSION_CODE。可能 $PUBLIC_BASE 不是这台机器，或域名还没反代。" >&2
    echo "  直连检查：curl -s http://${SSH_HOST#*@}:8080/api/v1/system/app-release" >&2
  else
    echo "✓ app-release 已返回 versionCode=$VERSION_CODE"
    code="$(curl -s -o /dev/null -w '%{http_code}' -I --max-time 10 "$PUBLIC_BASE/downloads/$FILE_NAME" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then
      echo "✓ 下载地址可访问：$PUBLIC_BASE/downloads/$FILE_NAME"
    else
      echo "⚠ 下载地址返回 $code：$PUBLIC_BASE/downloads/$FILE_NAME（检查 nginx 的 /downloads/ 反代）" >&2
    fi
  fi
else
  cat <<EOF

✅ 包已就位：$PUBLIC_BASE/downloads/$FILE_NAME

把这九行贴进服务器 $COMPOSE_DIR/.env（版本号必须比线上 APK 大，否则没人更新）：

$(cat "$SNIPPET")

或者直接重跑一次并加 --write-env，脚本会自动备份 .env、替换这九行并重启 backend：
  bash scripts/publish_apk.sh "$APK" "$VERSION_NAME" "$VERSION_CODE" "$CHANGELOG" --write-env

自检：
  curl -s $PUBLIC_BASE/api/v1/system/app-release
EOF
fi

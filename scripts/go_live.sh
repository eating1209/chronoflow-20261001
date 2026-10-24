#!/usr/bin/env bash
#
# 上架前的一次性修复：新后端上北京 → 发 1.1.0 包 → 杭州域名反代 → 线上自检。
#
# 为什么要有这个脚本：线上两个问题都不是 App 的，而是服务器没更新：
#   ① 北京 60.205.142.205 跑的还是旧 jar（隐私政策里是旧公司名/旧法定代表人，versionCode 13）；
#   ② chronocloud.top 在杭州 8.136.20.182，nginx 没把 /api、/downloads 反代到北京，
#      所以合规页返回 401，商店抓取会判不合格。
#
# 用法（在仓库根目录）：
#   bash scripts/go_live.sh                 # 全流程
#   bash scripts/go_live.sh --skip-backend  # 后端已部署，只发包 + 修域名
#   bash scripts/go_live.sh --skip-apk      # 包已发过，只部署后端 + 修域名
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEY_BJ="${CHRONOFLOW_DEPLOY_KEY:-$HOME/.ssh/60.205.142.205-北京.pem}"
KEY_HZ="${CHRONOFLOW_DEPLOY_KEY_HZ:-$HOME/.ssh/8.136.20.182-杭州.pem}"
HOST_BJ="root@60.205.142.205"
HOST_HZ="root@8.136.20.182"
APK="$ROOT/app/android/app/build/outputs/apk/release/app-release.apk"
VERSION_NAME="1.1.0"
VERSION_CODE="14"
CHANGELOG="上架版本 1.1.0：合规文本更新、接入备案域名、版本号更新"

SKIP_BACKEND=0
SKIP_APK=0
for arg in "$@"; do
  case "$arg" in
    --skip-backend) SKIP_BACKEND=1 ;;
    --skip-apk) SKIP_APK=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

step() { echo; echo "──────── $* ────────"; }

step "0/4 检查两台服务器能不能登录"
for k in "$KEY_BJ" "$KEY_HZ"; do
  [ -f "$k" ] || { echo "✗ 找不到私钥：$k" >&2; echo "  先按提示把 pem 放进 ~/.ssh 并 chmod 600" >&2; exit 1; }
  perm="$(stat -c '%a' "$k")"
  [ "$perm" = "600" ] || { echo "✗ $k 权限是 $perm，ssh 会拒绝。执行：chmod 600 '$k'" >&2; exit 1; }
done
# 第一次登录时 known_hosts 里没有这台机器，BatchMode 下 ssh 会直接报
# "Host key verification failed"（不会弹确认）。这里按 TOFU 记录一次指纹；
# 指纹对不上（重装过系统）也重新记录，但会明确说出来。
ssh_check() {
  local key="$1" host="$2"
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
      -i "$key" "$host" true 2>/dev/null && return 0
  echo "  ↳ 重新记录 $host 的指纹（旧记录与新服务器不一致时会走到这里）"
  ssh-keygen -R "${host#*@}" >/dev/null 2>&1 || true
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
      -i "$key" "$host" true
}

if ! ssh_check "$KEY_BJ" "$HOST_BJ"; then
  echo "✗ 连不上北京 $HOST_BJ（密钥对不对？机器在不在？）" >&2
  exit 1
fi
echo "  ✓ 北京 $HOST_BJ"
if ! ssh_check "$KEY_HZ" "$HOST_HZ"; then
  echo "✗ 连不上杭州 $HOST_HZ（密钥对不对？机器在不在？）" >&2
  exit 1
fi
echo "  ✓ 杭州 $HOST_HZ"

if [ "$SKIP_BACKEND" = "0" ]; then
  step "1/4 北京：部署新后端（首次要下 Maven 依赖，10–20 分钟）"
  if ! CHRONOFLOW_DEPLOY_KEY="$KEY_BJ" bash scripts/deploy_backend.sh; then
    echo "✗ 后端部署失败，先停在这里，别继续发包。" >&2
    exit 1
  fi
else
  step "1/4 跳过后端部署"
fi

if [ "$SKIP_APK" = "0" ]; then
  step "2/4 北京：发布 $VERSION_NAME ($VERSION_CODE) 安装包"
  [ -f "$APK" ] || { echo "✗ 没有 APK：$APK" >&2; exit 1; }
  # 末尾的域名验收此刻必然失败（域名还没反代），所以不因它中断
  CHRONOFLOW_DEPLOY_KEY="$KEY_BJ" bash scripts/publish_apk.sh \
    "$APK" "$VERSION_NAME" "$VERSION_CODE" "$CHANGELOG" --write-env \
    || echo "⚠ 发布脚本末尾的域名验收没过是正常的（下一步才修域名）"
else
  step "2/4 跳过发包"
fi

step "3/4 杭州：chronocloud.top 的 /api、/uploads、/map、/downloads 反代到北京"
# 杭州这台的事实（2026-10-18 实测）：443 上 server_name chronocloud.top 的块里
# 整站 proxy_pass http://127.0.0.1:8080（老应用，带登录拦截，所以合规页 401）。
# 只要在这个 server 块里加四个 location 指到北京，其余路径保持原样。
# ⚠ sites-enabled 里是软链，grep -r 不会跟，必须用 -R。
scp -q -i "$KEY_HZ" deploy/nginx-chronocloud-proxy.conf "$HOST_HZ:/etc/nginx/chronocloud-proxy.conf" \
  || { echo "✗ 传 nginx 片段失败" >&2; exit 1; }

ssh -i "$KEY_HZ" "$HOST_HZ" 'bash -s' <<'REMOTE'
set -uo pipefail
mkdir -p /etc/nginx/snippets
mv -f /etc/nginx/chronocloud-proxy.conf /etc/nginx/snippets/chronocloud-proxy.conf
INC="    include /etc/nginx/snippets/chronocloud-proxy.conf;"
CONF="$(grep -Rl "server_name[[:space:]]*chronocloud\.top" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -1)"
[ -n "$CONF" ] || CONF="$(grep -Rl "server_name[[:space:]]*chronocloud\.top" /etc/nginx/sites-available 2>/dev/null | head -1)"
if [ -z "$CONF" ]; then
  echo "✗ 没找到 chronocloud.top 的站点文件" >&2; exit 1
fi
echo "  站点文件：$CONF"
if grep -q "chronocloud-proxy" "$CONF"; then
  echo "  ↳ 已经加过，跳过修改"
else
  cp -a "$CONF" "$CONF.bak.$(date +%Y%m%d%H%M%S)"
  # 只插到「listen 443 …」之后的那个 server_name chronocloud.top 后面，
  # 不能插到 80 的块里（80 是跳转，不需要这些 location）。
  awk -v inc="$INC" '
    /^[[:space:]]*listen[[:space:]]+443/ { see443 = 1 }
    see443 && /^[[:space:]]*server_name[[:space:]]+chronocloud\.top/ && !done { print; print inc; done = 1; next }
    { print }
  ' "$CONF" > /tmp/nginx.new
  if ! grep -q "chronocloud-proxy" /tmp/nginx.new; then
    echo "✗ 没能在 443 的 server 块里定位 server_name chronocloud.top，未改动" >&2
    exit 1
  fi
  mv /tmp/nginx.new "$CONF"
  echo "  ↳ 已插入 include（原件备份为 *.bak.*）"
fi
if ! nginx -t; then
  BAK="$(ls -1t "$CONF".bak.* 2>/dev/null | head -1)"
  [ -n "$BAK" ] && cp -a "$BAK" "$CONF" && echo "✗ nginx 检查没过，已还原 $BAK" >&2
  exit 1
fi
nginx -s reload && echo "  ↳ nginx 已重载"
sleep 2
for p in /api/v1/legal/user-agreement /api/v1/system/info /downloads/chronoflow-1.1.0.apk; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -k -I -H 'Host: chronocloud.top' "https://127.0.0.1$p")"
  echo "  本机 https://chronocloud.top$p → $code"
done
REMOTE

step "4/4 线上自检"
bash scripts/check_live.sh || true

echo
echo "如果上面「备案域名」那一段全是 200 且是「新公司名/陶伊婷」，就说明全部修好了。"
echo "还有一行没做：应用宝后台的备案变更（签名 MD5、负责人、极光推送 SDK），见 docs/02-合规/上架资质核对.md"

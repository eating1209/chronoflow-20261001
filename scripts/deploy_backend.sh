#!/usr/bin/env bash
#
# 一键部署后端 jar，并验证合规文本已经更新。
#
# 用法（在仓库根目录执行）：
#   bash scripts/deploy_backend.sh
#
# 默认部署到新环境 60.205.142.205；要部署到老环境就覆盖：
#   CHRONOFLOW_DEPLOY_HOST=root@8.136.20.182 \
#   CHRONOFLOW_DEPLOY_KEY=~/develop/workspace/8.136.20.182-杭州.pem \
#   CHRONOFLOW_REMOTE_DIR=/opt/xatodo/backend \
#   CHRONOFLOW_REMOTE_COMPOSE_DIR=/opt/xatodo \
#   CHRONOFLOW_BACKEND_PUBLIC_BASE=http://8.136.20.182:8088 \
#   bash scripts/deploy_backend.sh
#
# 这个脚本会做五件事：
#   1. 检查源码里没有旧公司名 / 旧法定代表人；
#   2. 打 jar，并在上传前确认 jar 里真的带上了新的隐私政策（防止"传了个旧包"）；
#   3. 上传 jar 并重建 backend 容器；
#   4. 轮询直连地址，确认页面已经是新文本；
#   5. 顺带检查备案域名（默认 https://chronocloud.top），没反代到位只提示、不中断。
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend-java"
POLICY="$ROOT/docs/legal/privacy-policy.md"
JAR="$BACKEND/chronoflow-bootstrap/target/chronoflow-bootstrap-0.1.0-SNAPSHOT.jar"

OPERATOR="舟山市时纪云人工智能应用软件有限责任公司"
LEGAL_REP="陶伊婷"

HOST="${CHRONOFLOW_DEPLOY_HOST:-root@60.205.142.205}"
KEY="${CHRONOFLOW_DEPLOY_KEY:-$HOME/.ssh/60.205.142.205-北京.pem}"
REMOTE_DIR="${CHRONOFLOW_REMOTE_DIR:-/opt/chronoflow/backend}"
COMPOSE_DIR="${CHRONOFLOW_REMOTE_COMPOSE_DIR:-/opt/chronoflow}"
PUBLIC_BASE="${CHRONOFLOW_BACKEND_PUBLIC_BASE:-http://60.205.142.205:8080}"
VERIFY_DOMAIN="${CHRONOFLOW_VERIFY_DOMAIN:-}"
if [ -z "$VERIFY_DOMAIN" ] && [ "$HOST" = "root@60.205.142.205" ]; then
  VERIFY_DOMAIN="https://chronocloud.top"
fi

# JAVA_HOME / Maven：优先用显式传入的，其次按常见路径找，最后退回 PATH。
if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in "$HOME"/tools/jdk-21* /home/jiang/tools/jdk-21* /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/*21*; do
    [ -x "$candidate/bin/java" ] && { JAVA_HOME="$candidate"; break; }
  done
fi
if [ -n "${JAVA_HOME:-}" ] && [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "⚠ JAVA_HOME 不可用（$JAVA_HOME），改用到 PATH 里的 java" >&2
  unset JAVA_HOME
fi

# 后端 pom 要求 Java 21（maven.compiler.release=21）。只装 17 的机器会在编译阶段报
# "invalid target release"，提示很不直观，这里提前说清楚。
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/java}"
JAVA_BIN="${JAVA_BIN:-java}"
JAVA_MAJOR="$("$JAVA_BIN" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -1)"
if [ -z "$JAVA_MAJOR" ] || [ "$JAVA_MAJOR" -lt 21 ]; then
  echo "✗ 后端要求 JDK 21，当前是 ${JAVA_MAJOR:-未知}。装一个：" >&2
  echo "  sudo apt install -y openjdk-21-jdk-headless" >&2
  exit 1
fi

if [ -z "${MVN:-}" ]; then
  if command -v mvn >/dev/null 2>&1; then
    MVN="$(command -v mvn)"
  else
    for candidate in "$HOME"/tools/apache-maven-*/bin/mvn /home/jiang/tools/apache-maven-*/bin/mvn; do
      [ -x "$candidate" ] && { MVN="$candidate"; break; }
    done
  fi
fi

echo "→ 检查源码：$POLICY"
if grep -qE "应用软件开发有限公司|法定代表人：陈诗音" "$POLICY"; then
  echo "✗ 源码还是旧文本，先把最新代码同步到这台机器再部署。" >&2
  exit 1
fi
grep -q "$OPERATOR" "$POLICY" || { echo "✗ 源码里没有新的公司名「$OPERATOR」" >&2; exit 1; }
grep -q "法定代表人：$LEGAL_REP" "$POLICY" || { echo "✗ 源码里没有新的法定代表人「$LEGAL_REP」" >&2; exit 1; }
grep -n "时纪云\|法定代表人" "$POLICY" | head -5

[ -n "${MVN:-}" ] && [ -x "$MVN" ] || { echo "✗ 找不到 Maven（可用 MVN=... 指定）" >&2; exit 1; }
if [ -n "${JAVA_HOME:-}" ]; then
  echo "→ 使用 JAVA_HOME=$JAVA_HOME"
else
  command -v java >/dev/null 2>&1 || { echo "✗ 找不到 java（可设置 JAVA_HOME）" >&2; exit 1; }
fi

echo "→ 打包后端（跳过测试）"
# 先试离线（构建机 ~/.m2 有缓存时最快）；换新机器后缓存是空的，离线必然失败，
# 这时自动退回联网下载依赖——以前写死 `-o`，新机器上会直接报"没有依赖"而看不出原因。
proxy_opts() {
  local url="${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}"
  [ -n "$url" ] || return 0
  local hp="${url#*://}"; hp="${hp%%/*}"
  local h="${hp%%:*}" p="${hp##*:}"
  [ "$p" = "$h" ] && p=8080
  printf -- "-Dhttp.proxyHost=%s -Dhttp.proxyPort=%s -Dhttps.proxyHost=%s -Dhttps.proxyPort=%s" "$h" "$p" "$h" "$p"
}
export MAVEN_OPTS="${MAVEN_OPTS:-$(proxy_opts)}"
if ! (cd "$BACKEND" && JAVA_HOME="${JAVA_HOME:-}" "$MVN" -o -q package -DskipTests); then
  echo "⚠ 离线构建失败（本机 Maven 缓存里没有全部依赖），改为联网下载…"
  (cd "$BACKEND" && JAVA_HOME="${JAVA_HOME:-}" "$MVN" -q package -DskipTests)
fi
[ -f "$JAR" ] || { echo "✗ 没有生成 jar：$JAR" >&2; exit 1; }
ls -lh "$JAR"

echo "→ 检查 jar 内的隐私政策是否已经是新文本"
python3 - "$JAR" "$OPERATOR" "$LEGAL_REP" <<'PY'
import sys, zipfile

jar, operator, legal_rep = sys.argv[1:4]
with zipfile.ZipFile(jar) as zf:
    names = [n for n in zf.namelist() if n.endswith("legal/privacy-policy.md")]
    if not names:
        sys.exit("✗ jar 里没有 legal/privacy-policy.md")
    text = zf.read(names[0]).decode("utf-8")
if "应用软件开发有限公司" in text or "法定代表人：陈诗音" in text:
    sys.exit("✗ jar 里仍是旧文本（pom 的资源目录或 jar 没更新）")
if operator not in text:
    sys.exit(f"✗ jar 里没有新公司名：{operator}")
if f"法定代表人：{legal_rep}" not in text:
    sys.exit(f"✗ jar 里没有新法定代表人：{legal_rep}")
print("✓ jar 内隐私政策已更新")
PY

echo "→ 上传到 $HOST:$REMOTE_DIR/"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "mkdir -p '$REMOTE_DIR'"
scp -i "$KEY" "$JAR" "$HOST:$REMOTE_DIR/chronoflow-bootstrap-0.1.0-SNAPSHOT.jar"

echo "→ 确保审核账号变量已透传进 compose（幂等；不需要时变量为空）"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "COMPOSE_DIR='$COMPOSE_DIR' bash -s" <<'REMOTE'
cd "$COMPOSE_DIR" || exit 0
if grep -q 'CHRONOFLOW_REVIEW_LOGIN_PHONE' docker-compose.yml 2>/dev/null; then
  exit 0
fi
cp docker-compose.yml "docker-compose.yml.bak.$(date +%Y%m%dT%H%M%SZ)"
python3 - <<'PY'
p = 'docker-compose.yml'
s = open(p, encoding='utf-8').read()
anchor = '      ALIYUN_SMS_TEMPLATE_CODE:'
i = s.find(anchor)
if i < 0:
    raise SystemExit(0)
line_end = s.find('\n', i)
add = ('\n      CHRONOFLOW_REVIEW_LOGIN_PHONE: ${CHRONOFLOW_REVIEW_LOGIN_PHONE:-}'
       '\n      CHRONOFLOW_REVIEW_LOGIN_CODE: ${CHRONOFLOW_REVIEW_LOGIN_CODE:-}')
s = s[:line_end] + add + s[line_end:]
open(p, 'w', encoding='utf-8').write(s)
print('  ↳ 已补两行审核变量')
PY
REMOTE

echo "→ 重建并重启 backend 容器（--build 必须带）"
ssh -i "$KEY" "$HOST" "cd '$COMPOSE_DIR' && (docker compose up -d --build backend || docker-compose up -d --build backend)"

verify() {
  local base="$1" required="$2" timeout="${3:-120}" body=""
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    sleep 3
    body="$(curl -fsS --max-time 8 "$base/api/v1/legal/privacy-policy?v=$(date +%s)" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -qE "应用软件开发有限公司|陈诗音"; then
      echo "⚠ $base 仍是旧文本（容器可能还没换成新 jar）" >&2
      return 1
    fi
    if printf '%s' "$body" | grep -q "$OPERATOR" && printf '%s' "$body" | grep -q "法定代表人：$LEGAL_REP"; then
      return 0
    fi
  done
  return 1
}

echo "→ 验证直连地址：$PUBLIC_BASE"
if verify "$PUBLIC_BASE" required 150; then
  echo "✓ 直连地址合规文本已更新"
  curl -fsS "$PUBLIC_BASE/api/v1/legal/privacy-policy?v=$(date +%s)" | grep -o '舟山市时纪云[^<]*' | head -1 || true
  curl -fsS "$PUBLIC_BASE/api/v1/legal/privacy-policy?v=$(date +%s)" | grep -o '法定代表人：[^<]*' | head -1 || true
else
  echo "✗ 直连地址没验证成功。检查：① $HOST 上容器是否真的用了新 jar；② $PUBLIC_BASE 是否就是这台机器。" >&2
  exit 1
fi

if [ -n "$VERIFY_DOMAIN" ] && [ "$VERIFY_DOMAIN" != "$PUBLIC_BASE" ]; then
  echo "→ 验证备案域名：$VERIFY_DOMAIN（没反代到位只提示，不影响本次部署）"
  if verify "$VERIFY_DOMAIN" optional 30; then
    echo "✓ 域名合规文本也已更新"
  else
    echo "⚠ 域名暂时没返回新文本（可能还是旧站 / 401 / 404）。" >&2
    echo "  按 docs/04-运维/DEPLOY.md §2.1 在 8.136.20.182 的 nginx 里把 /api、/uploads、/map、/downloads 反代到 $PUBLIC_BASE 即可。" >&2
  fi
fi

echo "✓ 后端部署完成"

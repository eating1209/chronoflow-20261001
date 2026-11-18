#!/usr/bin/env bash
#
# 从已有的“arm64 + x86_64”通用 APK 直接拆出真机包和模拟器包，并重新签名。
# 不需要 Gradle，适合包已经打好、只是要减小体积的情况。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${1:-/home/eating/chronoflow-1.1.8-taskbar5.apk}"
DESKTOP="${CHRONOFLOW_DESKTOP_DIR:-/mnt/d/33154/Desktop}"
OUT_DIR="${CHRONOFLOW_PACKAGE_DIR:-$HOME}"
SIGNING_ENV="${CHRONOFLOW_SIGNING_ENV:-$HOME/.chronoflow-signing.env}"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-$HOME/Android/Sdk/build-tools/36.0.0}"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"

[ -f "$SOURCE" ] || { echo "✗ 找不到源 APK：$SOURCE" >&2; exit 1; }
[ -x "$ZIPALIGN" ] || { echo "✗ 找不到 zipalign：$ZIPALIGN" >&2; exit 1; }
[ -x "$APKSIGNER" ] || { echo "✗ 找不到 apksigner：$APKSIGNER" >&2; exit 1; }
[ -f "$SIGNING_ENV" ] || { echo "✗ 找不到签名配置：$SIGNING_ENV" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$SIGNING_ENV"
set +a

VERSION="$(python3 - "$ROOT/app/app.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['expo']['version'])
PY
)"
WORK="$(mktemp -d /tmp/chronoflow-abi.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

strip_abi() {
  local keep="$1"
  local output="$2"
  python3 - "$SOURCE" "$output" "$keep" <<'PY'
import sys
import zipfile

source, output, keep = sys.argv[1:4]
with zipfile.ZipFile(source) as src, zipfile.ZipFile(output, 'w') as dst:
    for info in src.infolist():
        name = info.filename
        if name.startswith('lib/'):
            parts = name.split('/')
            if len(parts) > 2 and parts[1] != keep:
                continue
        upper = name.upper()
        if upper.startswith('META-INF/') and upper.endswith(('.SF', '.RSA', '.DSA', '.EC')):
            continue
        dst.writestr(info, src.read(info))
PY
}

sign_one() {
  local abi="$1"
  local suffix="$2"
  local raw="$WORK/raw-${suffix}.apk"
  local aligned="$WORK/aligned-${suffix}.apk"
  local signed="$WORK/signed-${suffix}.apk"
  local out="$WORK/chronoflow-${VERSION}-${suffix}.apk"

  echo "→ 拆分 ${suffix}（${abi}）"
  strip_abi "$abi" "$raw"
  "$ZIPALIGN" -f -P 16 4 "$raw" "$aligned"
  "$APKSIGNER" sign \
    --ks "$CHRONOFLOW_KEYSTORE" \
    --ks-pass env:CHRONOFLOW_KEYSTORE_PASSWORD \
    --ks-key-alias "$CHRONOFLOW_KEY_ALIAS" \
    --key-pass env:CHRONOFLOW_KEY_PASSWORD \
    --out "$signed" "$aligned"
  "$APKSIGNER" verify --print-certs "$signed" >/dev/null
  cp -f "$signed" "$out"
  mkdir -p "$OUT_DIR"
  cp -f "$signed" "$OUT_DIR/chronoflow-${VERSION}-${suffix}.apk"
  mkdir -p "$DESKTOP"
  if cp -f "$signed" "$DESKTOP/chronoflow-${VERSION}-${suffix}.apk" 2>/dev/null; then
    echo "✓ $DESKTOP/chronoflow-${VERSION}-${suffix}.apk"
  else
    echo "⚠ 桌面不可写，已保留在：$OUT_DIR/chronoflow-${VERSION}-${suffix}.apk"
  fi
  echo "✓ $out"
  echo "✓ $OUT_DIR/chronoflow-${VERSION}-${suffix}.apk"
}

sign_one "arm64-v8a" "phone"
sign_one "x86_64" "emulator"

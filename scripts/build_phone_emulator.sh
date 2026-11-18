#!/usr/bin/env bash
#
# 和之前一样分开出两个包：
#   chronoflow-<版本>-phone.apk      → arm64-v8a，真机
#   chronoflow-<版本>-emulator.apk   → x86_64，模拟器
#
# 两个包都使用同一套 release 签名；不要用模拟器包装真机，也不要反过来。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGNING_ENV="${CHRONOFLOW_SIGNING_ENV:-$HOME/.chronoflow-signing.env}"
DESKTOP="${CHRONOFLOW_DESKTOP_DIR:-/mnt/d/33154/Desktop}"
OUT_DIR="${CHRONOFLOW_PACKAGE_DIR:-$HOME}"

if [ ! -f "$SIGNING_ENV" ]; then
  echo "✗ 找不到签名配置：$SIGNING_ENV" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SIGNING_ENV"
set +a

cd "$ROOT"
VERSION="$(python3 -c "import json;print(json.load(open('app/app.json'))['expo']['version'])")"
BUILT="$ROOT/app/android/app/build/outputs/apk/release/app-release.apk"

build_one() {
  local arch="$1"
  local suffix="$2"
  local dest="$OUT_DIR/chronoflow-${VERSION}-${suffix}.apk"

  echo
  echo "===== 构建 ${suffix}: ${arch} ====="
  bash scripts/build_apk.sh --release "--archs=${arch}"
  [ -f "$BUILT" ] || { echo "✗ 没有生成 APK：$BUILT" >&2; exit 1; }
  cp -f "$BUILT" "$dest"
  mkdir -p "$DESKTOP"
  cp -f "$BUILT" "$DESKTOP/chronoflow-${VERSION}-${suffix}.apk"
  echo "✓ $dest"
  echo "✓ $DESKTOP/chronoflow-${VERSION}-${suffix}.apk"
}

TARGET="${1:-both}"
case "$TARGET" in
  phone) build_one "arm64-v8a" "phone" ;;
  emulator) build_one "x86_64" "emulator" ;;
  both)
    build_one "arm64-v8a" "phone"
    build_one "x86_64" "emulator"
    ;;
  *)
    echo "用法：bash scripts/build_phone_emulator.sh [phone|emulator|both]" >&2
    exit 1
    ;;
esac

echo
echo "完成：真机装 phone 包，模拟器装 emulator 包。"

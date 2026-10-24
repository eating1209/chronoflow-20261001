#!/usr/bin/env bash
#
# 在 WSL 里操作 Windows 侧的 Android 模拟器。模拟器必须装在 Windows（WSL 没有 /dev/kvm）。
#
# 用法：
#   bash scripts/emulator.sh start            # 启动默认 AVD（可用 CHRONOFLOW_AVD 指定名字）
#   bash scripts/emulator.sh install [apk]    # 安装并启动（默认用刚出的 release 包）
#   bash scripts/emulator.sh log              # 看 JS 报错与崩溃日志（只打印最近的）
#   bash scripts/emulator.sh shot [文件名]     # 截一张模拟器当前画面到桌面
#
# 依赖：Windows 侧 Android SDK（Android Studio 默认装到
#   C:\Users\<你>\AppData\Local\Android\Sdk）。脚本会自动找 adb.exe / emulator.exe。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="com.chronoflow.frontend"
DESKTOP="${CHRONOFLOW_DESKTOP_DIR:-/mnt/d/33154/Desktop}"
WIN_DESKTOP="${CHRONOFLOW_WIN_DESKTOP:-D:\\33154\\Desktop}"

find_sdk() {
  local candidates=(
    "${ANDROID_SDK_WIN:-}"
    "/mnt/c/Users/${WIN_USER:-33154}/AppData/Local/Android/Sdk"
    "/mnt/c/Users/33154/AppData/Local/Android/Sdk"
  )
  for dir in "${candidates[@]}"; do
    if [ -n "$dir" ] && [ -x "$dir/platform-tools/adb.exe" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

SDK="$(find_sdk || true)"
if [ -z "$SDK" ]; then
  echo "✗ 没找到 Windows 侧 Android SDK。" >&2
  echo "  先装 Android Studio，并在 SDK Manager 里装 Android SDK Platform-Tools。" >&2
  echo "  如果装到了别的位置：ANDROID_SDK_WIN='C:\\path\\to\\Sdk' bash scripts/emulator.sh ..." >&2
  exit 1
fi
ADB="$SDK/platform-tools/adb.exe"
EMULATOR="$SDK/emulator/emulator.exe"

cmd="${1:-}"
case "$cmd" in
  start)
    AVD="${CHRONOFLOW_AVD:-}"
    if [ -z "$AVD" ]; then
      AVD="$("$EMULATOR" -list-avds | tr -d '\r' | head -1)"
    fi
    [ -n "$AVD" ] || { echo "✗ 没有可用的 AVD，请先在 Android Studio 的 Device Manager 里建一个。" >&2; exit 1; }
    echo "→ 启动模拟器：$AVD"
    ("$EMULATOR" -avd "$AVD" >/dev/null 2>&1 &)
    "$ADB" wait-for-device
    echo "✓ 已连接：$("$ADB" devices | tr -d '\r' | sed -n '2p')"
    ;;

  install)
    APK="${2:-$ROOT/app/android/app/build/outputs/apk/release/app-release.apk}"
    [ -f "$APK" ] || { echo "✗ 找不到 apk：$APK（先跑 scripts/build_apk.sh）" >&2; exit 1; }
    if ! "$ADB" devices | tr -d '\r' | grep -q "device$"; then
      echo "✗ 模拟器没连上，先跑：bash scripts/emulator.sh start" >&2
      exit 1
    fi
    # Windows 版 adb 输出带 CRLF，所有解析都要先 tr -d '\r'（否则 device$ 永远匹配不上）
    EMU_ABI="$("$ADB" shell getprop ro.product.cpu.abi | tr -d '\r\n')"
    APK_ABIS="$(python3 - "$APK" <<'PY'
import sys, zipfile
abis = set()
with zipfile.ZipFile(sys.argv[1]) as zf:
    for name in zf.namelist():
        if name.startswith("lib/"):
            abis.add(name.split("/")[1])
print(" ".join(sorted(abis)))
PY
)"
    echo "→ 模拟器 ABI：${EMU_ABI:-未知}；APK 包含：${APK_ABIS:-未知}"
    if [ -n "$EMU_ABI" ] && ! echo " $APK_ABIS " | grep -q " $EMU_ABI "; then
      echo "✗ 这个 APK 装不进模拟器：模拟器是 $EMU_ABI，包内只有 $APK_ABIS。" >&2
      echo "  模拟器请用 x86_64 包：bash scripts/build_apk.sh --prebuild --release --archs=x86_64" >&2
      echo "  （给真机 / 上架仍然用 --archs=arm64-v8a）" >&2
      exit 1
    fi

    mkdir -p "$DESKTOP"
    cp "$APK" "$DESKTOP/chronoflow-emulator.apk"
    echo "→ 安装到模拟器（$(du -h "$APK" | cut -f1)）"
    "$ADB" install -r "$WIN_DESKTOP\\chronoflow-emulator.apk"
    "$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
    echo "✓ 已启动 $APP_ID"
    ;;

  log)
    echo "→ 最近 300 行 JS 日志与崩溃（Ctrl+C 退出后仍在看历史；加 -f 可实时）"
    "$ADB" logcat -d -t 300 ReactNativeJS:V AndroidRuntime:E chronoflow:V '*:S'
    ;;

  shot)
    NAME="${2:-chronoflow-emulator.png}"
    TMP="/sdcard/chronoflow-shot.png"
    "$ADB" shell screencap -p "$TMP"
    "$ADB" pull "$TMP" "$DESKTOP/$NAME" >/dev/null
    "$ADB" shell rm -f "$TMP"
    echo "✓ 截图：$DESKTOP/$NAME"
    ;;

  *)
    sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac

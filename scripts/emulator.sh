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
WIN_USER="${WIN_USER:-33154}"
WIN_HOME_WSL="/mnt/c/Users/$WIN_USER"
AVD_NAME="${CHRONOFLOW_AVD:-Medium_Phone_API_37.0}"
AVD_HOME_WIN="${CHRONOFLOW_AVD_HOME_WIN:-D:\\Android\\avd}"
AVD_HOME_WSL="${CHRONOFLOW_AVD_HOME_WSL:-/mnt/d/Android/avd}"
START_LOG="${CHRONOFLOW_EMULATOR_LOG:-/home/eating/start-chronoflow-emulator.log}"

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
TASKLIST="/mnt/c/Windows/System32/tasklist.exe"

win_to_wsl() {
  local win_path="$1" drive rest
  win_path="${win_path//\\//}"
  if [[ "$win_path" =~ ^([A-Za-z]):/(.*)$ ]]; then
    drive="$(printf '%s' "${BASH_REMATCH[1]}" | tr 'A-Z' 'a-z')"
    rest="${BASH_REMATCH[2]}"
    printf '/mnt/%s/%s\n' "$drive" "$rest"
  fi
}

find_avd_dir() {
  local ini="$AVD_HOME_WSL/$AVD_NAME.ini" declared
  if [ -f "$ini" ]; then
    declared="$(sed -n 's/^path=//p' "$ini" | tr -d '\r' | head -1)"
    if [ -n "$declared" ]; then
      win_to_wsl "$declared"
      return 0
    fi
  fi
  printf '%s\n' "$AVD_HOME_WSL/$AVD_NAME.avd"
}

emulator_running() {
  [ -x "$TASKLIST" ] || return 1
  "$TASKLIST" /FI 'IMAGENAME eq emulator.exe' /FO CSV /NH 2>/dev/null \
    | tr -d '\r' | grep -qi 'emulator\.exe' && return 0
  "$TASKLIST" /FI 'IMAGENAME eq qemu-system-x86_64.exe' /FO CSV /NH 2>/dev/null \
    | tr -d '\r' | grep -qi 'qemu-system-x86_64\.exe'
}

cmd="${1:-}"
case "$cmd" in
  start)
    AVD="$AVD_NAME"
    if [ -z "$AVD" ]; then
      AVD="$(ANDROID_AVD_HOME="$AVD_HOME_WIN" "$EMULATOR" -list-avds | tr -d '\r' | head -1)"
    fi
    [ -n "$AVD" ] || { echo "✗ 没有可用的 AVD，请先在 Android Studio 的 Device Manager 里建一个。" >&2; exit 1; }
    AVD_DIR="$(find_avd_dir)"
    [ -d "$AVD_DIR" ] || { echo "✗ 找不到 AVD 目录：$AVD_DIR" >&2; exit 1; }
    if ! emulator_running; then
      shopt -s nullglob
      for lock in "$AVD_DIR"/*.lock; do
        echo "→ 清理上次异常退出留下的锁：$(basename "$lock")"
        rm -rf -- "$lock"
      done
      shopt -u nullglob
    fi
    echo "→ AVD 目录：$AVD_HOME_WIN"
    echo "→ 冷启动模拟器：$AVD"
    : > "$START_LOG"
    (
      cd "$WIN_HOME_WSL"
      ANDROID_AVD_HOME="$AVD_HOME_WIN" "$EMULATOR" -avd "$AVD" -no-snapshot-load -no-boot-anim \
        >"$START_LOG" 2>&1 &
    )
    SERIAL=""
    for i in $(seq 1 150); do
      SERIAL="$("$ADB" devices 2>/dev/null | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}' || true)"
      [ -n "$SERIAL" ] && break
      if [ $((i % 15)) -eq 0 ]; then
        echo "→ 仍在等待模拟器连接 adb（$((i * 2)) 秒）…"
        if ! emulator_running; then
          echo "✗ 模拟器进程已经退出。" >&2
          [ -f "$START_LOG" ] && tail -80 "$START_LOG" >&2
          exit 1
        fi
      fi
      sleep 2
    done
    [ -n "$SERIAL" ] || { echo "✗ 模拟器 5 分钟内没有连上 adb。" >&2; [ -f "$START_LOG" ] && tail -80 "$START_LOG" >&2; exit 1; }
    echo "✓ 已连接：$SERIAL"
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

#!/usr/bin/env bash
#
# 抓一次顶部任务条的现场信息：当前前台页、系统桌面包、权限、服务和原生场景日志。
# 在普通 WSL 终端运行；结果同时打印并保存到 Windows 桌面。
set -euo pipefail

WIN_USER="${WIN_USER:-33154}"
DESKTOP="${CHRONOFLOW_DESKTOP_DIR:-/mnt/d/33154/Desktop}"
OUT="$DESKTOP/chronoflow-taskbar-debug.txt"
APP_ID="com.chronoflow.frontend"

find_sdk() {
  local candidates=(
    "${ANDROID_SDK_WIN:-}"
    "/mnt/c/Users/${WIN_USER}/AppData/Local/Android/Sdk"
    "/mnt/c/Users/33154/AppData/Local/Android/Sdk"
  )
  local dir
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
  echo "✗ 没找到 Windows 侧 Android SDK，可用 ANDROID_SDK_WIN 指定。" >&2
  exit 1
fi
ADB="$SDK/platform-tools/adb.exe"

SERIAL="$("$ADB" devices 2>/dev/null | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$SERIAL" ]; then
  echo "✗ 模拟器/手机没有连上 adb。" >&2
  exit 1
fi

mkdir -p "$DESKTOP"
: > "$OUT"
section() {
  printf '\n===== %s =====\n' "$1"
}
adb_shell() {
  "$ADB" -s "$SERIAL" shell "$@" 2>&1 | tr -d '\r'
}

{
  echo "采集时间：$(date '+%F %T')"
  echo "设备：$SERIAL"

  section "安装版本"
  adb_shell dumpsys package "$APP_ID" | grep -E 'versionCode=|versionName=' | head -4 || true

  section "当前前台"
  adb_shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity|mFocusedApp' | head -12 || true
  adb_shell dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp' | head -8 || true

  section "系统桌面包"
  adb_shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME || true
  adb_shell cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME || true

  section "权限"
  adb_shell appops get "$APP_ID" GET_USAGE_STATS || true
  adb_shell appops get "$APP_ID" SYSTEM_ALERT_WINDOW || true
  adb_shell dumpsys package "$APP_ID" | grep -E 'PACKAGE_USAGE_STATS|SYSTEM_ALERT_WINDOW' | head -12 || true

  section "任务条服务"
  adb_shell dumpsys activity services "$APP_ID" | sed -n '1,180p' || true

  section "任务条窗口"
  adb_shell dumpsys window windows | grep -E -A6 -B2 '时纪流顶部任务条|ChronoFlowTaskBar' | head -100 || true

  section "任务条日志"
  "$ADB" -s "$SERIAL" logcat -d -v time -s ChronoFlowTaskBar:D AndroidRuntime:E '*:S' 2>&1 \
    | tr -d '\r' | tail -160 || true
} | tee "$OUT"

echo
echo "✓ 诊断结果：$OUT"

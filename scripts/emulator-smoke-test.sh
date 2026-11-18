#!/usr/bin/env bash
#
# 一条命令在 Windows Android 模拟器里验证任务条，不需要把 APK 传到手机。
#
# 用法：
#   bash scripts/emulator-smoke-test.sh [apk]
#
# 默认使用刚生成的 x86_64 模拟器包。脚本会：
#   1. 启动 AVD（如果还没启动）
#   2. 覆盖安装 APK
#   3. 预先授予通知权限、悬浮窗权限
#   4. 打开「我的 → 偏好」，依次打开「任务栏与锁屏显示」和「顶部任务小条」
#   5. 回到桌面，检查悬浮条服务、窗口和通知
#   6. 在桌面留下截图、界面 XML 和日志
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="${1:-/home/eating/chronoflow-1.1.8-taskbar5.apk}"
APP_ID="com.chronoflow.frontend"
DESKTOP="${CHRONOFLOW_DESKTOP_DIR:-/mnt/d/33154/Desktop}"
WIN_DESKTOP="${CHRONOFLOW_WIN_DESKTOP:-D:\\33154\\Desktop}"
WIN_USER="${WIN_USER:-33154}"
WIN_HOME_WSL="/mnt/c/Users/$WIN_USER"
AVD_NAME="${CHRONOFLOW_AVD:-Medium_Phone_API_37.0}"
AVD_HOME_WIN="${CHRONOFLOW_AVD_HOME_WIN:-D:\\Android\\avd}"
AVD_HOME_WSL="${CHRONOFLOW_AVD_HOME_WSL:-/mnt/d/Android/avd}"
START_LOG="${CHRONOFLOW_EMULATOR_LOG:-/home/eating/start-chronoflow-emulator.log}"
UI_REMOTE="/sdcard/chronoflow-window.xml"
SHOT_REMOTE="/sdcard/chronoflow-shot.png"

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
  echo "✗ 没找到 Windows 侧 Android SDK，路径可用 ANDROID_SDK_WIN 指定。" >&2
  exit 1
fi
ADB="$SDK/platform-tools/adb.exe"
EMULATOR="$SDK/emulator/emulator.exe"
TASKLIST="/mnt/c/Windows/System32/tasklist.exe"

if [ ! -f "$APK" ]; then
  echo "✗ 找不到 APK：$APK" >&2
  exit 1
fi

online_device() {
  "$ADB" devices 2>/dev/null | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1; exit}'
}

win_to_wsl() {
  local win_path="$1" drive rest
  win_path="${win_path//\\//}"
  case "$win_path" in
    [A-Za-z]:/*)
      drive="$(printf '%s' "${win_path:0:1}" | tr 'A-Z' 'a-z')"
      rest="${win_path:2}"
      printf '/mnt/%s%s\n' "$drive" "$rest"
      ;;
  esac
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

clear_stale_locks() {
  local avd_dir lock cleared=0
  emulator_running && return 0
  avd_dir="$(find_avd_dir)"
  shopt -s nullglob
  for lock in "$avd_dir"/*.lock; do
    echo "→ 清理上次异常退出留下的锁：$(basename "$lock")"
    rm -rf -- "$lock"
    cleared=1
  done
  shopt -u nullglob
  [ "$cleared" -eq 0 ] || sleep 1
}

start_emulator() {
  local avd_dir
  avd_dir="$(find_avd_dir)"
  if [ ! -d "$avd_dir" ]; then
    echo "✗ 找不到 AVD 目录：$avd_dir" >&2
    echo "  当前使用：CHRONOFLOW_AVD=$AVD_NAME，CHRONOFLOW_AVD_HOME_WIN=$AVD_HOME_WIN" >&2
    exit 1
  fi
  clear_stale_locks
  echo "→ AVD 目录：$AVD_HOME_WIN"
  echo "→ 冷启动模拟器：$AVD_NAME"
  : > "$START_LOG"
  (
    cd "$WIN_HOME_WSL"
    ANDROID_AVD_HOME="$AVD_HOME_WIN" "$EMULATOR" \
      -avd "$AVD_NAME" -no-snapshot-load -no-boot-anim \
      >"$START_LOG" 2>&1 &
  )
}

SERIAL="$(online_device || true)"
if [ -z "$SERIAL" ]; then
  start_emulator
  for i in $(seq 1 150); do
    SERIAL="$(online_device || true)"
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
fi

if [ -z "$SERIAL" ]; then
  echo "✗ 模拟器 5 分钟内没有连上 adb。" >&2
  [ -f "$START_LOG" ] && tail -80 "$START_LOG" >&2
  exit 1
fi
echo "→ 模拟器已连接：$SERIAL"

SCREEN_W=1080
SCREEN_H=2400
SIZE="$("$ADB" -s "$SERIAL" shell wm size 2>/dev/null | tr -d '\r' | awk -F'[:x ]+' '/Physical size/ {print $(NF-1), $NF}' || true)"
if [ -n "$SIZE" ]; then
  SCREEN_W="${SIZE%% *}"
  SCREEN_H="${SIZE##* }"
fi

for i in $(seq 1 90); do
  BOOT="$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')"
  [ "$BOOT" = "1" ] && break
  sleep 2
done
if [ "${BOOT:-0}" != "1" ]; then
  echo "✗ 模拟器启动超时。" >&2
  exit 1
fi

mkdir -p "$DESKTOP"
UI="$DESKTOP/chronoflow-emulator-ui.xml"
LOG="$DESKTOP/chronoflow-emulator-log.txt"

dump_ui() {
  "$ADB" -s "$SERIAL" shell uiautomator dump "$UI_REMOTE" >/dev/null 2>&1 || return 1
  rm -f "$UI"
  "$ADB" -s "$SERIAL" pull "$UI_REMOTE" "$WIN_DESKTOP\\chronoflow-emulator-ui.xml" >/dev/null 2>&1 || return 1
  [ -f "$UI" ]
}

# 在 uiautomator XML 里找文字 / accessibilityLabel，输出控件中心点坐标。
ui_coords() {
  python3 - "$UI" "$1" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, label = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()

def center(node):
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
    if not match:
        return None
    x1, y1, x2, y2 = map(int, match.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2

best = None
for node in root.iter('node'):
    desc = (node.get('content-desc') or '').strip()
    text = (node.get('text') or '').strip()
    cls = (node.get('class') or '').lower()
    point = center(node)
    if not point:
        continue
    if desc == label:
        score = 0
    elif ('switch' in cls or node.get('checkable') == 'true') and label in (desc or text):
        score = 1
    elif text == label:
        score = 2
    elif label in desc:
        score = 3
    elif label in text:
        score = 4
    else:
        continue
    if node.get('clickable') == 'true':
        score -= 0.5
    if best is None or score < best[0]:
        best = (score, point)
if best:
    print(best[1][0], best[1][1])
PY
}

ui_checked() {
  python3 - "$UI" "$1" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, label = sys.argv[1], sys.argv[2]
root = ET.parse(path).getroot()
for node in root.iter('node'):
    desc = (node.get('content-desc') or '').strip()
    text = (node.get('text') or '').strip()
    if desc == label or text == label:
        print('1' if node.get('checked') == 'true' else '0')
        raise SystemExit(0)
PY
}

tap_label() {
  local label="$1"
  local attempts="${2:-12}"
  local i
  for i in $(seq 1 "$attempts"); do
    if dump_ui; then
      local coords
      coords="$(ui_coords "$label" 2>/dev/null || true)"
      if [ -n "$coords" ]; then
        # shellcheck disable=SC2086
        "$ADB" -s "$SERIAL" shell input tap $coords >/dev/null 2>&1 || true
        sleep 1
        return 0
      fi
    fi
    if [ $((i % 4)) -eq 0 ]; then
      "$ADB" -s "$SERIAL" shell input swipe \
        "$((SCREEN_W / 2))" "$((SCREEN_H * 3 / 4))" \
        "$((SCREEN_W / 2))" "$((SCREEN_H / 3))" 300 >/dev/null 2>&1 || true
      sleep 1
    fi
    sleep 1
  done
  return 1
}

wait_checked() {
  local label="$1"
  local attempts="${2:-10}"
  local i
  for i in $(seq 1 "$attempts"); do
    if dump_ui; then
      local value
      value="$(ui_checked "$label" 2>/dev/null || true)"
      [ "$value" = "1" ] && return 0
    fi
    sleep 1
  done
  return 1
}

shot() {
  local name="$1"
  "$ADB" -s "$SERIAL" shell screencap -p "$SHOT_REMOTE" >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" pull "$SHOT_REMOTE" "$WIN_DESKTOP\\$name" >/dev/null 2>&1 || true
}

collect_artifacts() {
  "$ADB" -s "$SERIAL" logcat -d -t 1200 > "$LOG" 2>/dev/null || true
  dump_ui || true
  shot "chronoflow-emulator-failure.png"
}

fail() {
  echo
  echo "✗ FAIL：$*"
  collect_artifacts
  echo "日志：D:\\33154\\Desktop\\chronoflow-emulator-log.txt"
  echo "界面：D:\\33154\\Desktop\\chronoflow-emulator-ui.xml"
  echo "截图：D:\\33154\\Desktop\\chronoflow-emulator-failure.png"
  exit 1
}

cp "$APK" "$DESKTOP/chronoflow-emulator.apk"
echo "→ 安装：$APK"
"$ADB" -s "$SERIAL" install -r "$WIN_DESKTOP\\chronoflow-emulator.apk"

# 模拟用户在系统里点过「允许通知」「允许显示在其他应用上层」。
"$ADB" -s "$SERIAL" shell pm grant "$APP_ID" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell appops set "$APP_ID" SYSTEM_ALERT_WINDOW allow >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell appops set "$APP_ID" GET_USAGE_STATS allow >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true

echo "→ 启动 App，并等待首屏加载…"
"$ADB" -s "$SERIAL" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 12

PID="$("$ADB" -s "$SERIAL" shell pidof "$APP_ID" 2>/dev/null | tr -d '\r\n ')"
[ -n "$PID" ] || fail "App 进程已退出（闪退）"

echo "→ 打开「我的 → 偏好」"
tap_label "我的" || fail "找不到底部「我的」，可能没有登录或页面还没加载完"
tap_label "偏好" || fail "找不到「偏好」入口"
sleep 1

echo "→ 打开「任务栏与锁屏显示」"
tap_label "任务栏与锁屏显示" || fail "找不到「任务栏与锁屏显示」开关"
for label in 继续 允许 确定; do
  tap_label "$label" 2 >/dev/null 2>&1 || true
done
wait_checked "任务栏与锁屏显示" 8 || fail "「任务栏与锁屏显示」没有成功打开"

echo "→ 打开「顶部任务小条」"
tap_label "顶部任务小条" || fail "找不到「顶部任务小条」开关"
wait_checked "顶部任务小条" 8 || fail "「顶部任务小条」没有成功打开"

shot "chronoflow-emulator-settings.png"

echo "→ 回到桌面，检查悬浮条…"
"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true

SERVICES=""
WINDOWS=""
NOTIFS=""
for i in $(seq 1 12); do
  SERVICES="$("$ADB" -s "$SERIAL" shell dumpsys activity services "$APP_ID" 2>/dev/null | tr -d '\r' || true)"
  WINDOWS="$("$ADB" -s "$SERIAL" shell dumpsys window windows 2>/dev/null | tr -d '\r' || true)"
  NOTIFS="$("$ADB" -s "$SERIAL" shell dumpsys notification --noredact 2>/dev/null | tr -d '\r' || true)"
  if echo "$SERVICES" | grep -q 'TaskBarOverlayService' \
    && echo "$WINDOWS" | grep -q '时纪流顶部任务条'; then
    break
  fi
  sleep 1
done

sleep 2
shot "chronoflow-emulator-home.png"
"$ADB" -s "$SERIAL" logcat -d -t 1200 > "$LOG" 2>/dev/null || true

PID="$("$ADB" -s "$SERIAL" shell pidof "$APP_ID" 2>/dev/null | tr -d '\r\n ')"
[ -n "$PID" ] || fail "开启任务条后 App 进程退出了（闪退）"
echo "$SERVICES" | grep -q 'TaskBarOverlayService' || fail "悬浮条服务没有启动"
echo "$WINDOWS" | grep -q '时纪流顶部任务条' || fail "桌面上没有出现「时纪流顶部任务条」悬浮窗"
echo "$NOTIFS" | grep -q '时纪流顶部任务小条' || fail "通知栏里没有「时纪流顶部任务小条」"
grep -Eq 'FATAL EXCEPTION|Process: com\.chronoflow\.frontend' "$LOG" && fail "日志里有崩溃堆栈"

echo
echo "✓ PASS：App 没闪退；两个开关都已打开；桌面上有三色任务条；通知栏有常驻任务条。"
echo "进程 PID：$PID"
echo "设置截图：D:\\33154\\Desktop\\chronoflow-emulator-settings.png"
echo "桌面截图：D:\\33154\\Desktop\\chronoflow-emulator-home.png"
echo "日志：D:\\33154\\Desktop\\chronoflow-emulator-log.txt"
echo "界面：D:\\33154\\Desktop\\chronoflow-emulator-ui.xml"

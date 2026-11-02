#!/usr/bin/env bash
#
# 上传应用宝之前先跑这一条：确认“这个包能不能装进真手机”。
#
# 2026-10-20 应用宝驳回：“无法安装，显示系统不兼容（小米 10S / 小米 15 Pro）”。
# 真因是传了只带 x86_64 的模拟器包——x86_64 是电脑模拟器的架构，真手机是 arm64-v8a。
# 这个脚本把当时手工查的几项固化下来，一条命令全过一遍。
#
# 用法：
#   bash scripts/check_apk.sh                     # 默认检查最新出的 release 包
#   bash scripts/check_apk.sh /path/to/xxx.apk
#
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="${1:-$ROOT/app/android/app/build/outputs/apk/release/app-release.apk}"

if [ ! -f "$APK" ]; then
  echo "✗ 没找到 APK：$APK" >&2
  echo "  先出包：bash scripts/build_apk.sh --release --archs=arm64-v8a" >&2
  exit 1
fi

echo "检查：$APK"
ls -lh "$APK" | awk '{print "  大小："$5}'
FAIL=0

# ---- 1. ABI：这条就是这次被驳回的原因 ----
ABIS=$(python3 - "$APK" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as apk:
    print(" ".join(sorted({n.split('/')[1] for n in apk.namelist() if n.startswith("lib/")})))
PY
)
echo "  ABI：${ABIS:-（没有原生库）}"
case " $ABIS " in
  *" arm64-v8a "*)
    echo "  ✓ 含 arm64-v8a，真手机能装" ;;
  *)
    echo "  ✗ 不含 arm64-v8a —— 这是模拟器包，装到任何一台真手机都会显示「系统不兼容」"
    FAIL=1 ;;
esac

# ---- 2. minSdk / 版本 / 包名 ----
SDK_DIR=""
for candidate in "${ANDROID_HOME:-}" "$HOME/Android/Sdk"; do
  [ -n "$candidate" ] && [ -d "$candidate/build-tools" ] && SDK_DIR="$candidate" && break
done
if [ -n "$SDK_DIR" ]; then
  AAPT2="$(ls -d "$SDK_DIR"/build-tools/*/ 2>/dev/null | sort -V | tail -1)aapt2"
  if [ -x "$AAPT2" ]; then
    BADGING=$("$AAPT2" dump badging "$APK" 2>/dev/null | head -4)
    PKG=$(echo "$BADGING" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
    VC=$(echo "$BADGING" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p")
    VN=$(echo "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")
    MIN=$(echo "$BADGING" | sed -n "s/^minSdkVersion:'\([0-9]*\)'/\1/p")
    TGT=$(echo "$BADGING" | sed -n "s/^targetSdkVersion:'\([0-9]*\)'/\1/p")
    echo "  包名 $PKG · 版本 $VN ($VC) · minSdk $MIN · targetSdk $TGT"
  fi

  # ---- 3. 正式签名 ----
  APKSIGNER="$(dirname "$AAPT2")/apksigner"
  if [ -x "$APKSIGNER" ]; then
    if "$APKSIGNER" verify "$APK" >/dev/null 2>&1; then
      MD5=$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null | sed -n 's/.*certificate MD5 digest: //p' | head -1)
      echo "  ✓ 签名有效（MD5 $MD5）"
    else
      echo "  ✗ 签名校验失败，装不上" ; FAIL=1
    fi
  fi
fi

# ---- 4. 16KB 页对齐（Android 15+ 的 16KB 页机型，不对齐会装不上/闪退）----
python3 - "$APK" <<'PY' || FAIL=1
import struct, sys, zipfile
path = sys.argv[1]
bad, checked = [], 0
with zipfile.ZipFile(path) as apk:
    for name in apk.namelist():
        if not (name.startswith("lib/") and name.endswith(".so")):
            continue
        data = apk.read(name)
        if data[:4] != b"\x7fELF":
            continue
        is64 = data[4] == 2
        phoff, phentsize, phnum = (struct.unpack_from("<QHH", data, 32) if is64
                                   else struct.unpack_from("<IHH", data, 28))
        aligns = []
        for i in range(phnum):
            base = phoff + i * phentsize
            p_type = struct.unpack_from("<I", data, base)[0]
            p_align = (struct.unpack_from("<Q", data, base + 48)[0] if is64
                       else struct.unpack_from("<I", data, base + 28)[0])
            if p_type == 1:
                aligns.append(p_align)
        checked += 1
        if any(a < 0x4000 for a in aligns):
            bad.append(name)
print(f"  16KB 对齐：检查了 {checked} 个 .so")
if bad:
    print("  ✗ 以下库不是 16KB 对齐：" + ", ".join(bad[:5]))
    sys.exit(1)
print("  ✓ 全部 16KB 对齐")
PY

# ---- 5. 权限：高危的不能有；语音要的麦克风必须有 ----
if [ -n "$SDK_DIR" ] && [ -x "$AAPT2" ]; then
  PERMS=$("$AAPT2" dump permissions "$APK" 2>/dev/null || true)
  BAD_PERMS=$(printf '%s\n' "$PERMS" \
    | grep -E "ACCESS_BACKGROUND_LOCATION|READ_PHONE_STATE|QUERY_ALL_PACKAGES|SYSTEM_ALERT_WINDOW" || true)
  if [ -n "$BAD_PERMS" ]; then
    echo "  ✗ 包里还有高危权限（隐私检测会点名）："
    echo "$BAD_PERMS" | sed 's/^/      /'
    echo "    改法：app.json 的 android.blockedPermissions 加进去，再 expo prebuild"
    FAIL=1
  else
    echo "  ✓ 没有后台定位 / 读手机状态 / 应用列表 / 悬浮窗"
  fi
  # RECORD_AUDIO 从 2026-11-01 起是**真的在用**（长按说话），不能再按高危权限拦掉；
  # 反过来要确认它在包里——声明了但构建期被删，用户点了只会一直失败。
  if printf '%s\n' "$PERMS" | grep -q "RECORD_AUDIO"; then
    echo "  ✓ 含 RECORD_AUDIO（语音输入，已声明）"
  else
    echo "  ✗ 包里没有 RECORD_AUDIO —— 语音输入会拿不到麦克风权限"
    echo "    改法：app.json 的 android.permissions 加 android.permission.RECORD_AUDIO，"
    echo "          并确认它不在 blockedPermissions 里"
    FAIL=1
  fi
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "✓ 这个包可以传应用宝"
else
  echo "✗ 这个包不能传应用宝，按上面的红字改" >&2
  exit 1
fi

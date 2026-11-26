#!/usr/bin/env bash
#
# 出一版 Android debug APK —— 把这台机器上**踩过的坑**全部固化下来。
#
# 为什么要有这个脚本：`expo prebuild` 会**重新生成** `app/android/gradle.properties`，
# 把我们写在 `~/.gradle/gradle.properties` 里的内存保护（workers.max / parallel=false）
# 全部覆盖掉。结果是原生编译（CMake + ninja + 几十个 clang++）瞬间吃掉几个 GB，
# 在 7.4GB 的 WSL 里触发内核 OOM killer —— 2026-10-01 就这么崩过两次：
#
#   kernel: Out of memory: Killed process 1571 (java) total-vm:13500628kB, anon-rss:2243952kB
#   （同一时刻还有二十多个 clang++ 在跑）
#
# 崩掉的后果不只是构建失败：整个 WSL 虚拟机被重启，跑在里面的一切（Metro、agent 会话）
# 一起没了，终端还留在鼠标追踪模式，于是鼠标一动就往屏幕上刷 `35;61;18M…`。
#
# 用法：
#   scripts/build_apk.sh                        # debug 包（给模拟器用，需要 Metro）
#   scripts/build_apk.sh --prebuild             # 先 expo prebuild --clean 再编译（改了 app.json 时用）
#   scripts/build_apk.sh --release --archs=arm64-v8a,x86_64
#                                               # 独立可用的包（JS 打进包里，装到手机就能跑）
#
# 编译完会**顺手复制一份到 Windows 桌面**（`/mnt/c/Users/jiang/Desktop/时纪流-<版本>(<versionCode>)-<debug|release>.apk`），
# 联调时从桌面拖进模拟器/手机最省事；换目录用 `CHRONOFLOW_DESKTOP_DIR=...`。
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
ANDROID="$APP/android"

# 工具链按「环境变量 → 本机常见路径」解析，**不再写死某个人账号下的目录**：
# 以前默认 /home/jiang/tools/...，换一台机器就整条链路失效（第一次在新机器上跑就踩到）。
if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in /usr/lib/jvm/java-17-openjdk-amd64 /usr/lib/jvm/java-21-openjdk-amd64; do
    if [ -x "$candidate/bin/javac" ]; then JAVA_HOME="$candidate"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
  cat >&2 <<'MSG'
✗ 没找到可用的 JDK 17。装一个：
    sudo apt update && sudo apt install -y openjdk-17-jdk-headless
  或显式指定：export JAVA_HOME=/path/to/jdk-17
MSG
  exit 1
fi
export JAVA_HOME

if [ -z "${ANDROID_HOME:-}" ]; then
  for candidate in "$HOME/Android/Sdk" /opt/android-sdk /usr/lib/android-sdk; do
    if [ -d "$candidate/platform-tools" ]; then ANDROID_HOME="$candidate"; break; fi
  done
fi
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "$ANDROID_HOME" ]; then
  cat >&2 <<'MSG'
✗ 没找到 Android SDK。按 docs/04-运维/开发环境搭建.md 装好后再跑：
    export ANDROID_HOME=$HOME/Android/Sdk
MSG
  exit 1
fi
export ANDROID_HOME

GRADLE_HOME_DIR="${CHRONOFLOW_GRADLE_HOME:-}"

# —— 代理：Java / Gradle **不读** https_proxy 环境变量 ——
# 国内直连 services.gradle.org 常被劫持，证书校验失败（PKIX path building failed）：
# 已经有 http(s)_proxy 的环境里，这里把它翻译成 JVM 的 -D 参数，wrapper 下载 Gradle
# 与后续依赖解析都会走代理。代理连不上时不强行设置，避免把「代理没开」变成构建失败。
PROXY_URL="${https_proxy:-${HTTPS_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}"
if [ -z "${GRADLE_OPTS:-}" ] && [ -n "$PROXY_URL" ]; then
  PROXY_HOSTPORT="${PROXY_URL#*://}"
  PROXY_HOSTPORT="${PROXY_HOSTPORT%%/*}"
  PROXY_HOST="${PROXY_HOSTPORT%%:*}"
  PROXY_PORT="${PROXY_HOSTPORT##*:}"
  [ "$PROXY_PORT" = "$PROXY_HOST" ] && PROXY_PORT=8080
  if timeout 2 bash -c "exec 3<>/dev/tcp/$PROXY_HOST/$PROXY_PORT" 2>/dev/null; then
    export GRADLE_OPTS="-Dhttp.proxyHost=$PROXY_HOST -Dhttp.proxyPort=$PROXY_PORT -Dhttps.proxyHost=$PROXY_HOST -Dhttps.proxyPort=$PROXY_PORT"
    echo "→ Gradle 走代理 $PROXY_HOST:$PROXY_PORT"
  else
    echo "⚠ 检测到代理 $PROXY_HOST:$PROXY_PORT 但连不上，按直连处理（Gradle 下载可能因证书校验失败）" >&2
    PROXY_HOST=""
  fi
fi

# 关键：把 CMake/ninja 的并行度压到 2。AGP 里 Gradle worker 数管不到 ninja 内部的 -j，
# 而这个环境变量是 CMake 官方认的（`cmake --build` 会照它设 ninja 的并行度）。
export CMAKE_BUILD_PARALLEL_LEVEL="${CMAKE_BUILD_PARALLEL_LEVEL:-2}"

BUILD_TYPE="debug"
ARCHS="${CHRONOFLOW_ARCHS:-}"
ARCHS_EXPLICIT="${CHRONOFLOW_ARCHS:+1}"
for arg in "$@"; do
  case "$arg" in
    --prebuild) PREBUILD=1 ;;
    --release) BUILD_TYPE="release" ;;
    --debug) BUILD_TYPE="debug" ;;
    --archs=*) ARCHS="${arg#--archs=}"; ARCHS_EXPLICIT=1 ;;
  esac
done
# 默认 ABI 按构建类型分开：debug 给模拟器（x86_64），release 给真机/上架（arm64-v8a）。
# 2026-10-20 踩过：release 沿用了 x86_64 默认值，出的包在应用宝审核机上「系统不兼容」——
# x86_64 包装不进任何一台真手机。上架包一律 arm64-v8a，除非显式指定别的。
if [ -z "$ARCHS" ]; then
  if [ "$BUILD_TYPE" = "release" ]; then ARCHS="arm64-v8a"; else ARCHS="x86_64"; fi
fi

# 上架包必须是 64 位 ARM。只出 x86_64（模拟器包）时**不阻断**（还要用它联调），
# 但后面会把桌面文件名标成 -emulator，并在结尾打一条大红警告，避免再把它传去审核。
RELEASE_IS_DEVICE_PKG=1
case ",$ARCHS," in
  *,arm64-v8a,*) RELEASE_IS_DEVICE_PKG=1 ;;
  *) RELEASE_IS_DEVICE_PKG=0 ;;
esac

# 上架包必须用正式签名：缺一个变量就**在构建前失败**，不要等到提审被打回。
# 插件 `app/plugins/withReleaseSigning.js` 负责把 signingConfigs 注入 build.gradle，
# 这里负责在 prebuild / gradle 之前就把人和环境变量都卡住。
if [ "$BUILD_TYPE" = "release" ]; then
  export CHRONOFLOW_REQUIRE_RELEASE_SIGNING=1
  MISSING_SIGNING=()
  for name in CHRONOFLOW_KEYSTORE CHRONOFLOW_KEYSTORE_PASSWORD CHRONOFLOW_KEY_ALIAS CHRONOFLOW_KEY_PASSWORD; do
    [ -n "${!name:-}" ] || MISSING_SIGNING+=("$name")
  done
  if [ ${#MISSING_SIGNING[@]} -gt 0 ]; then
    cat >&2 <<MSG
✗ release 包必须用正式签名，缺少环境变量：${MISSING_SIGNING[*]}

  生成一次（之后复用并备份，丢了就再也发不了这个包名的更新）：
    mkdir -p ~/keys
    keytool -genkeypair -v -keystore ~/keys/chronoflow-release.jks -alias chronoflow \\
      -keyalg RSA -keysize 2048 -validity 36500

  构建前导出（口令自己设，别写进仓库）：
    export CHRONOFLOW_KEYSTORE=$HOME/keys/chronoflow-release.jks
    export CHRONOFLOW_KEYSTORE_PASSWORD='...'
    export CHRONOFLOW_KEY_ALIAS=chronoflow
    export CHRONOFLOW_KEY_PASSWORD='...'
MSG
    exit 1
  fi
  if [ ! -f "$CHRONOFLOW_KEYSTORE" ]; then
    echo "✗ CHRONOFLOW_KEYSTORE 指向的文件不存在：$CHRONOFLOW_KEYSTORE" >&2
    exit 1
  fi
fi

if [ "${PREBUILD:-0}" = "1" ]; then
  echo "→ expo prebuild --platform android --clean"
  (cd "$APP" && npx expo prebuild --platform android --clean)
fi

[ -d "$ANDROID" ] || { echo "没有 $ANDROID：先跑 scripts/build_apk.sh --prebuild" >&2; exit 1; }

# prebuild 会把这两个又要紧又容易被覆盖的配置改回去，每次构建前重新钉一遍
echo "→ 固定 gradle 配置（ABI=$ARCHS + 压低内存/并行）"
python3 - "$ANDROID/gradle.properties" "$ARCHS" <<'PY'
import re, sys, pathlib
path = pathlib.Path(sys.argv[1])
archs = sys.argv[2]
text = path.read_text(encoding="utf-8")
wanted = {
    # 4 个 ABI 会让原生库合并慢到离谱（实测 28 分钟还没完）。
    # 模拟器用 x86_64，真机要 arm64-v8a；要给别人的安装包就两个都带上（通用包）。
    "reactNativeArchitectures": archs,
    "org.gradle.jvmargs": "-Xmx2048m -XX:MaxMetaspaceSize=512m",
    "org.gradle.parallel": "false",
    "org.gradle.workers.max": "2",
    "org.gradle.daemon": "false",
    "org.gradle.caching": "true",
}
lines = text.splitlines()
seen = set()
for index, line in enumerate(lines):
    match = re.match(r"^([A-Za-z0-9_.]+)=", line)
    if match and match.group(1) in wanted:
        key = match.group(1)
        lines[index] = f"{key}={wanted[key]}"
        seen.add(key)
for key, value in wanted.items():
    if key not in seen:
        lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

# Java / Gradle 不认 http_proxy 环境变量；把上面探测到的代理写进 Gradle 的 systemProp，
# 这样依赖解析（google() / mavenCentral() / jitpack）也走代理。prebuild 会重建本文件，
# 所以每次构建前补一次；已经有就不重复写。
if [ -n "${PROXY_HOST:-}" ] && ! grep -q "systemProp.https.proxyHost" "$ANDROID/gradle.properties"; then
  {
    echo ""
    echo "# build_apk.sh 注入：Java 不读 https_proxy，这里显式指定"
    echo "systemProp.http.proxyHost=$PROXY_HOST"
    echo "systemProp.http.proxyPort=$PROXY_PORT"
    echo "systemProp.https.proxyHost=$PROXY_HOST"
    echo "systemProp.https.proxyPort=$PROXY_PORT"
  } >> "$ANDROID/gradle.properties"
fi

# 某些第三方原生模块的 build.gradle 比这台机器上的 Gradle 9 还老（见脚本里的注释）。
# 每次构建前重新打一遍补丁：node_modules 会被 npm 重装覆盖，补丁不能只打一次。
bash "$ROOT/scripts/patch-third-party-gradle.sh"

# workspace 包 @chronoflow/design-tokens 的 main 指向 dist/index.js，`npm ci` 不会自动编译它。
# 缺了 dist 时，Metro 会在 createBundleReleaseJsAndAssets 阶段失败（新机器第一次出包就踩到）。
if [ ! -f "$ROOT/packages/design-tokens/dist/index.js" ]; then
  echo "→ 编译 @chronoflow/design-tokens（Metro 需要它的 dist/）"
  (cd "$ROOT" && npm run build -w @chronoflow/design-tokens)
fi

# 端侧 OCR 的 PaddleOCR 模型（16MB）不进版本库（见 .gitignore 与 fetch_ppocr_models.sh）。
# 缺了它们，Metro 会在打包阶段报 `Unable to resolve module ...onnx`，看着像代码问题。
# 这个脚本是幂等的：文件齐了只做体积校验（不联网），缺了才下载。
echo "→ 确认端侧 OCR 模型（PaddleOCR PP-OCRv4）"
bash "$ROOT/scripts/fetch_ppocr_models.sh"

# app.json 里的版本号要**钉进 build.gradle**：`android/` 是 `expo prebuild` 生成后就不再跟着
# app.json 变的（CNG 只在你显式 prebuild 时重写）。2026-10-01 就踩过这一条：app.json 改成
# 0.0.2/3，包名也叫 chronoflow-0.0.2.apk，**包里的 versionCode 还是 2、versionName 还是 0.0.1**
# → 手机装上后「还是提示有新版本」，无限弹更新。这里每次构建前对齐一次，杜绝再犯。
echo "→ 把 app.json 的版本钉进 android/app/build.gradle"
python3 - "$ANDROID/app/build.gradle" "$APP/app.json" <<'PY'
import json, re, sys, pathlib

gradle = pathlib.Path(sys.argv[1])
config = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))["expo"]
version_name = config["version"]
version_code = int(config["android"]["versionCode"])
text = gradle.read_text(encoding="utf-8")
patched, count_code = re.subn(r"\bversionCode\s+\d+", f"versionCode {version_code}", text, count=1)
patched, count_name = re.subn(r'\bversionName\s+"[^"]*"', f'versionName "{version_name}"', patched, count=1)
if not count_code or not count_name:
    sys.stderr.write("⚠ 没在 build.gradle 里找到 versionCode / versionName，请人工看一眼\n")
    sys.exit(1)
gradle.write_text(patched, encoding="utf-8")
print(f"  versionName={version_name} versionCode={version_code}")
PY

if [ "$BUILD_TYPE" = "release" ]; then
  TASK=":app:assembleRelease"
  OUT="$ANDROID/app/build/outputs/apk/release/app-release.apk"
else
  TASK=":app:assembleDebug"
  OUT="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
fi

echo "→ 编译 $BUILD_TYPE APK（workers=2, ninja=$CMAKE_BUILD_PARALLEL_LEVEL, ABI=$ARCHS）"
if [ -x "$ANDROID/gradlew" ]; then
  GRADLE_CMD="$ANDROID/gradlew"
elif [ -n "$GRADLE_HOME_DIR" ] && [ -x "$GRADLE_HOME_DIR/bin/gradle" ]; then
  GRADLE_CMD="$GRADLE_HOME_DIR/bin/gradle"
else
  echo "✗ 既没有 android/gradlew，也没有 CHRONOFLOW_GRADLE_HOME 指向的 gradle" >&2
  echo "  先跑 scripts/build_apk.sh --prebuild（会生成 gradlew），或 export CHRONOFLOW_GRADLE_HOME=..." >&2
  exit 1
fi
(cd "$ANDROID" && "$GRADLE_CMD" "$TASK" \
  --no-daemon --max-workers=2 --console=plain)

[ -f "$OUT" ] || { echo "编译结束但没找到 APK" >&2; exit 1; }
echo
echo "✅ $OUT"
ls -lh "$OUT"

# 通知卡布局由 expo prebuild 从 plugins/taskbar-native/res 复制。增量构建曾经出现
# Kotlin 已引用新 ID、resources.arsc 却还是旧布局的情况，运行时会直接报
# "No field taskbar_compact_legend of type I"。这里在出包后硬检查一次，宁可构建失败
# 也不要把“通知和状态栏任务条都点不开”的包交出去。
echo "→ 检查任务条通知资源是否完整"
python3 - "$OUT" <<'PY'
import sys, zipfile

path = sys.argv[1]
required = [
    "taskbar_notification_collapsed",
    "taskbar_compact_legend",
    "taskbar_compact_task",
    "taskbar_compact_title",
    "taskbar_compact_when",
    "taskbar_compact_circle",
]
with zipfile.ZipFile(path) as apk:
    resources = apk.read("resources.arsc")
missing = [name for name in required if name.encode("utf-8") not in resources]
if missing:
    sys.stderr.write("✗ APK 里缺少任务条资源：" + ", ".join(missing) + "\n")
    sys.stderr.write("  用 bash scripts/build_apk.sh --prebuild ... 重新生成 android/ 后再出包。\n")
    sys.exit(1)
print("  任务条通知资源 ID 完整")
PY

# release 包顺手打印签名指纹：应用宝后台与 App 备案要填的就是这两个值。
# 用 apksigner 而不是 keytool：AGP 只打 v2/v3 签名，`keytool -printcert -jarfile` 读不了，
# 会静默输出空（2026-10-18 第一次出正式包时就是这样，指纹没打出来）。
if [ "$BUILD_TYPE" = "release" ]; then
  APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -1)apksigner"
  if [ -x "$APKSIGNER" ]; then
    echo "→ 签名指纹（应用宝 / 备案要填）"
    "$APKSIGNER" verify --print-certs "$OUT" 2>/dev/null \
      | grep -E "certificate (DN|MD5 digest|SHA-1 digest|SHA-256 digest)" || true
  else
    echo "  （没找到 apksigner；用 build-tools 里的 apksigner verify --print-certs 查看指纹）"
  fi
fi

# 16KB 页对齐检查（Android 15+ 的 16KB 页机型**必须**满足，否则一启动就闪退）。
# 见 `scripts/patch-third-party-gradle.sh` 里 onnxruntime 那段：libonnxruntimejsi.so 曾经是
# 0x1000，整台手机上的 App 直接打不开，而模拟器/老机型看不出问题——所以这里**构建期硬卡**。
# 本机没有 unzip/readelf，用纯 python 解 zip + 读 ELF program header，任何机器都能跑。
echo "→ 检查包内 .so 的 16KB 页对齐"
python3 - "$OUT" <<'PY'
import struct, sys, zipfile

path = sys.argv[1]
bad = []
checked = 0
with zipfile.ZipFile(path) as apk:
    for name in apk.namelist():
        if not (name.startswith("lib/") and name.endswith(".so")):
            continue
        data = apk.read(name)
        if data[:4] != b"\x7fELF":
            continue
        is64 = data[4] == 2
        if is64:
            phoff, phentsize, phnum = struct.unpack_from("<QHH", data, 32)
        else:
            phoff, phentsize, phnum = struct.unpack_from("<IHH", data, 28)
        aligns = []
        for index in range(phnum):
            base = phoff + index * phentsize
            if is64:
                p_type = struct.unpack_from("<I", data, base)[0]
                p_align = struct.unpack_from("<Q", data, base + 48)[0]
            else:
                p_type = struct.unpack_from("<I", data, base)[0]
                p_align = struct.unpack_from("<I", data, base + 28)[0]
            if p_type == 1:  # PT_LOAD
                aligns.append(p_align)
        checked += 1
        if any(align < 0x4000 for align in aligns):
            bad.append((name, [hex(align) for align in aligns]))

print(f"  检查了 {checked} 个 .so")
if bad:
    sys.stderr.write("✗ 这些库的 LOAD 段不是 16KB 对齐（Android 15+ 的 16KB 页机型上会加载失败、启动闪退）：\n")
    for name, aligns in bad:
        sys.stderr.write(f"    {name} → {', '.join(aligns)}\n")
    sys.stderr.write("  修法见 scripts/patch-third-party-gradle.sh（给对应模块补 -Wl,-z,max-page-size=16384）\n")
    sys.exit(1)
print("  ✓ 全部 16KB 对齐")
PY

# 顺手放一份到 Windows 桌面（WSL 路径 /mnt/c/...）。联调时从桌面拖进模拟器/手机最省事。
# 文件名带版本号与构建类型，桌面上堆多个包时一眼能分辨是哪个。
DESKTOP_DIR="${CHRONOFLOW_DESKTOP_DIR:-}"
if [ -z "$DESKTOP_DIR" ]; then
  # 自动找 Windows 桌面。注意桌面**不一定**在 C:\Users\<你>\Desktop：
  # 2026-10-18 这台机器就重定向到了 D:\33154\Desktop（C 盘那个是空的旧目录）。
  # 先扫 D 盘（本机实际位置），再扫 C:\Users；跳过 Default / Public 这类系统目录。
  for candidate in /mnt/d/*/Desktop /mnt/c/Users/*/Desktop; do
    case "$candidate" in
      *'/Default User/'*|*'/Default/'*|*'/Public/'*) continue ;;
    esac
    if [ -d "$candidate" ]; then DESKTOP_DIR="$candidate"; break; fi
  done
fi
if [ -d "$DESKTOP_DIR" ]; then
  VERSION_NAME=$(python3 -c "import json;print(json.load(open('$APP/app.json'))['expo']['version'])")
  VERSION_CODE=$(python3 -c "import json;print(json.load(open('$APP/app.json'))['expo']['android']['versionCode'])")
  # 命名与线上发布保持一致：chronoflow-<版本名>.apk（debug 包多带一个后缀区分）。
  # 以前叫「时纪流-0.0.0(1)-release.apk」：括号里是 versionCode，容易被误认成
  # 系统自动去重加的「 (1)」，而且和下载链接里的名字对不上。
  # 注意别写成 `$( [ ... ] && echo ... )`：条件不成立时那个子命令返回 1，
  # 赋值语句会把它当自己的退出码，配合 `set -e` 会让脚本**静默退出**（踩过）。
  if [ "$BUILD_TYPE" = debug ]; then
    DESKTOP_APK="$DESKTOP_DIR/chronoflow-${VERSION_NAME}-debug.apk"
  elif [ "$RELEASE_IS_DEVICE_PKG" = "1" ]; then
    DESKTOP_APK="$DESKTOP_DIR/chronoflow-${VERSION_NAME}.apk"
  else
    # 只带 x86_64 的 release 包：只能装模拟器，**绝不能上架**。
    # 以前它也叫 chronoflow-<版本>.apk，和真机包同名，2026-10-20 就是这么传错的。
    DESKTOP_APK="$DESKTOP_DIR/chronoflow-${VERSION_NAME}-emulator.apk"
  fi
  if cp -f "$OUT" "$DESKTOP_APK"; then
    echo "📋 已复制到桌面：$DESKTOP_APK"
  else
    echo "⚠️ 复制到桌面失败（$DESKTOP_APK），APK 仍在 $OUT" >&2
  fi
else
  echo "（桌面目录 $DESKTOP_DIR 不存在，跳过复制；可用 CHRONOFLOW_DESKTOP_DIR 指定）"
fi

# 最后一句提醒：这个包能不能上架，只看包里的 ABI。
if [ "$BUILD_TYPE" = "release" ] && [ "$RELEASE_IS_DEVICE_PKG" = "0" ]; then
  cat >&2 <<'WARN'

  ⚠️⚠️⚠️ 这个包只带 x86_64，**只能装模拟器，不能上架、不能装真手机**。
     应用宝会报「无法安装 / 系统不兼容」。上架请重跑：
       bash scripts/build_apk.sh --release --archs=arm64-v8a

WARN
fi

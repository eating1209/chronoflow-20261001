const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * 自带的 PCM 录音模块（Android）。
 *
 * <p>**为什么不能用 expo-audio**：它的 Android 实现基于 MediaRecorder，只能录
 * m4a/aac / amr；而离线语音识别（Whisper）要的是 **16 kHz 单声道 16-bit PCM**。
 * 云端虽然能直接吃 m4a，但两条通道用同一个 WAV 文件最简单，也免掉一次格式转换。
 *
 * <p>这里直读 `AudioRecord`，边录边写 WAV：采样率 / 声道 / 位深都是识别引擎要的形状，
 * 录完就是一个可以直接交给 whisper.rn 或 `POST /ai/transcribe` 的文件。
 *
 * <p>写法与 `withSystemLocation` 一致：CNG 的 prebuild 每次重建 `android/`，
 * 所以源码与注册都必须在插件里做，**不要手工改 `android/` 下的文件**。
 */
const JAVA_PACKAGE = 'com.chronoflow.frontend';
const MODULE_SOURCE = `package ${JAVA_PACKAGE};

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/**
 * 16 kHz / 单声道 / 16-bit PCM 录音，落成 WAV。
 *
 * <p>只暴露三个动作：start / stop / cancel。录音期间的数据写入在独立线程里，
 * 不占 JS 线程；停止时会把 WAV 头里的长度补上，所以拿到的永远是**完整可播放**的文件。
 *
 * <p>隐私：文件写在应用缓存目录，JS 侧转写完立即删除（见 asr/recording/pcmRecorder.ts）。
 */
public class PcmRecorderModule extends ReactContextBaseJavaModule {

    public static final String NAME = "ChronoflowPcm";

    private static final int DEFAULT_SAMPLE_RATE = 16000;
    private static final int CHANNELS = 1;
    private static final int BITS_PER_SAMPLE = 16;
    /** 128ms 左右的缓冲；比 minBufferSize 大一点，避免读取过于细碎 */
    private static final int BUFFER_BYTES = 4096;

    private AudioRecord record;
    private Thread worker;
    private File output;
    private volatile boolean recording;
    private volatile long bytesWritten;
    private int sampleRate = DEFAULT_SAMPLE_RATE;

    public PcmRecorderModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void start(double requestedRate, Promise promise) {
        if (recording) {
            promise.reject("E_AUDIO_BUSY", "正在录音");
            return;
        }
        int rate = requestedRate > 0 ? (int) requestedRate : DEFAULT_SAMPLE_RATE;
        int minBuffer = AudioRecord.getMinBufferSize(
                rate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) {
            promise.reject("E_AUDIO_UNAVAILABLE", "这台设备不支持 16kHz 录音");
            return;
        }

        AudioRecord created;
        try {
            created = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    rate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(minBuffer * 2, BUFFER_BYTES * 2));
        } catch (SecurityException ex) {
            promise.reject("E_AUDIO_PERMISSION", "没有录音权限");
            return;
        } catch (IllegalArgumentException ex) {
            promise.reject("E_AUDIO_UNAVAILABLE", "麦克风参数不被支持");
            return;
        }
        if (created.getState() != AudioRecord.STATE_INITIALIZED) {
            created.release();
            promise.reject("E_AUDIO_UNAVAILABLE", "麦克风初始化失败");
            return;
        }

        final File file = new File(
                getReactApplicationContext().getCacheDir(),
                "voice-" + System.currentTimeMillis() + ".wav");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(wavHeader(rate, 0));
            out.flush();
        } catch (IOException ex) {
            created.release();
            promise.reject("E_AUDIO_IO", "创建录音文件失败");
            return;
        }

        try {
            // 先真正开录，再回 JS：权限 / 设备问题要在 start 的 Promise 里暴露，
            // 而不是让界面以为「已经在录了」、30 秒后才发现一个字节都没有
            created.startRecording();
        } catch (SecurityException ex) {
            created.release();
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            promise.reject("E_AUDIO_PERMISSION", "没有录音权限");
            return;
        } catch (IllegalStateException ex) {
            created.release();
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            promise.reject("E_AUDIO_UNAVAILABLE", "麦克风被其他应用占用");
            return;
        }

        record = created;
        output = file;
        sampleRate = rate;
        bytesWritten = 0;
        recording = true;

        final AudioRecord active = created;
        worker = new Thread(() -> {
            byte[] buffer = new byte[BUFFER_BYTES];
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                while (recording) {
                    int read = active.read(buffer, 0, buffer.length);
                    if (read > 0) {
                        out.write(buffer, 0, read);
                        bytesWritten += read;
                    } else if (read < 0) {
                        break;
                    }
                }
                out.flush();
            } catch (Throwable ignored) {
                // 停止时 active.stop() 会让 read 抛错，这是正常路径；错误只在 stop 里兜
            } finally {
                try {
                    active.stop();
                } catch (Throwable ignored) {
                }
                active.release();
                if (record == active) {
                    record = null;
                }
            }
        }, "chronoflow-pcm-recorder");
        worker.start();
        promise.resolve(true);
    }

    @ReactMethod
    public void stop(Promise promise) {
        if (!recording) {
            promise.reject("E_AUDIO_IDLE", "没有正在进行的录音");
            return;
        }
        finishRecording();

        File file = output;
        output = null;
        if (file == null || !file.exists()) {
            promise.reject("E_AUDIO_IO", "录音文件不存在");
            return;
        }
        long dataSize = bytesWritten;
        try {
            patchWavHeader(file, dataSize);
        } catch (IOException ex) {
            // 头没补上也能交给识别引擎（它按实际数据读），但日志里要留痕
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            promise.reject("E_AUDIO_IO", "录音文件写入失败");
            return;
        }

        WritableMap result = Arguments.createMap();
        result.putString("path", file.getAbsolutePath());
        result.putDouble("durationMs", durationMs(dataSize));
        result.putDouble("size", file.length());
        promise.resolve(result);
    }

    @ReactMethod
    public void cancel(Promise promise) {
        if (!recording) {
            File stale = output;
            output = null;
            if (stale != null) {
                //noinspection ResultOfMethodCallIgnored
                stale.delete();
            }
            promise.resolve(null);
            return;
        }
        finishRecording();
        File file = output;
        output = null;
        if (file != null) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
        promise.resolve(null);
    }

    /** 停线程、停麦克风、等文件写完。stop 与 cancel 共用。 */
    private void finishRecording() {
        recording = false;
        AudioRecord active = record;
        if (active != null) {
            try {
                // 先 stop 打断阻塞中的 read()，否则 join 要等一个缓冲周期（约 128ms）
                active.stop();
            } catch (Throwable ignored) {
            }
        }
        Thread current = worker;
        worker = null;
        if (current != null) {
            try {
                current.join(2000L);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }
        record = null;
    }

    private long durationMs(long dataSize) {
        long bytesPerSecond = (long) sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8);
        return bytesPerSecond <= 0 ? 0 : dataSize * 1000L / bytesPerSecond;
    }

    private static byte[] wavHeader(int rate, int dataSize) {
        int byteRate = rate * CHANNELS * (BITS_PER_SAMPLE / 8);
        int blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
        ByteBuffer buffer = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        buffer.put("RIFF".getBytes(StandardCharsets.US_ASCII));
        buffer.putInt(36 + dataSize);
        buffer.put("WAVE".getBytes(StandardCharsets.US_ASCII));
        buffer.put("fmt ".getBytes(StandardCharsets.US_ASCII));
        buffer.putInt(16);
        buffer.putShort((short) 1);
        buffer.putShort((short) CHANNELS);
        buffer.putInt(rate);
        buffer.putInt(byteRate);
        buffer.putShort((short) blockAlign);
        buffer.putShort((short) BITS_PER_SAMPLE);
        buffer.put("data".getBytes(StandardCharsets.US_ASCII));
        buffer.putInt(dataSize);
        return buffer.array();
    }

    private static void patchWavHeader(File file, long dataSize) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(file, "rw")) {
            raf.seek(4);
            raf.write(intLe(36 + (int) dataSize));
            raf.seek(40);
            raf.write(intLe((int) dataSize));
        }
    }

    private static byte[] intLe(int value) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array();
    }
}
`;

const PACKAGE_SOURCE = `package ${JAVA_PACKAGE};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 注册 {@link PcmRecorderModule}（见 app/plugins/withPcmRecorder.js）。 */
public class PcmRecorderPackage implements ReactPackage {

    @Override
    public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new PcmRecorderModule(reactContext));
        return modules;
    }

    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;

const FILES = {
  'PcmRecorderModule.java': MODULE_SOURCE,
  'PcmRecorderPackage.java': PACKAGE_SOURCE,
};

module.exports = function withPcmRecorder(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot; // .../android
      const packagePath = path.join(
        projectRoot,
        'app',
        'src',
        'main',
        'java',
        ...JAVA_PACKAGE.split('.'),
      );
      fs.mkdirSync(packagePath, { recursive: true });
      for (const [name, source] of Object.entries(FILES)) {
        fs.writeFileSync(path.join(packagePath, name), source, 'utf8');
      }
      return cfg;
    },
  ]);

  return withMainApplication(config, (cfg) => {
    // Kotlin 模板：先补 import，再往 PackageList 的 apply 块里 add 一次
    let contents = cfg.modResults.contents;
    if (!contents.includes(`${JAVA_PACKAGE}.PcmRecorderPackage`)) {
      contents = contents.replace(
        /^(import expo\.modules\.ExpoReactHostFactory)$/m,
        `$1\nimport ${JAVA_PACKAGE}.PcmRecorderPackage`,
      );
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n          add(PcmRecorderPackage()) // [withPcmRecorder] 手工注册',
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });
};

package com.chronoflow.frontend

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 系统分享图片到 App 的中转站。
 *
 * <p>分享方给的是临时 `content://` 授权，App 不能长期持有，所以收到后先复制到自己的缓存目录，
 * JS 再拿 `file://` 路径去走现有的端侧 OCR。图片只落在本机缓存，不上传。
 *
 * <p>复制放在单独线程，JS 启动时用 [take] 等待结果；复制完成时也会发一次事件，
 * 这样 App 已在前台时不必等用户切页面才发现有新截图。
 */
internal object SharedImageBridge {
    private const val TAG = "ChronoflowShare"
    private const val PREFS = "chronoflow_share_import"
    private const val KEY_PATH = "pending_path"
    private const val KEY_MIME = "pending_mime"
    private const val FILE_PREFIX = "shared-image-"
    private const val WAIT_SECONDS = 12L

    internal data class ShareImage(val uri: String, val mimeType: String?)
    internal data class TakeResult(val image: ShareImage?, val error: String?)

    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "chronoflow-share-import")
    }
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val lock = Any()
    private var latch: CountDownLatch? = null
    private var result: ShareImage? = null
    private var failure: String? = null

    fun addListener(listener: () -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun isImageShare(intent: Intent?): Boolean {
        if (intent == null) {
            return false
        }
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) {
            return false
        }
        if (sharedUri(intent) == null) {
            return false
        }
        val mime = intent.type
        return mime.isNullOrBlank() || mime.startsWith("image/", ignoreCase = true)
    }

    /** 开始接收一张分享图片；返回 false 表示这不是图片分享，调用方不必再打开主界面。 */
    fun capture(context: Context, intent: Intent?): Boolean {
        if (!isImageShare(intent) || intent == null) {
            return false
        }
        val uri = sharedUri(intent) ?: return false
        val appContext = context.applicationContext
        val mimeType = intent.type ?: appContext.contentResolver.getType(uri)
        val gate = CountDownLatch(1)

        val accepted = synchronized(lock) {
            if (latch != null) {
                return@synchronized false
            }
            result?.let { previous ->
                Uri.parse(previous.uri).path?.let { path -> File(path).delete() }
            }
            appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_PATH)
                .remove(KEY_MIME)
                .apply()
            result = null
            failure = null
            latch = gate
            true
        }
        if (!accepted) {
            return true
        }

        executor.execute {
            try {
                cleanupOldFiles(appContext)
                val file = copyToCache(appContext, uri, mimeType)
                val image = ShareImage(Uri.fromFile(file).toString(), mimeType)
                synchronized(lock) {
                    result = image
                    failure = null
                    latch = null
                    appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(KEY_PATH, image.uri)
                        .putString(KEY_MIME, image.mimeType)
                        .apply()
                }
                Log.i(TAG, "分享图片已复制到本地缓存：${file.name}（${file.length()} 字节）")
                notifyReady()
            } catch (cause: Throwable) {
                val message = cause.message ?: "读取分享图片失败"
                synchronized(lock) {
                    result = null
                    failure = message
                    latch = null
                }
                Log.w(TAG, "读取分享图片失败：$message", cause)
                notifyReady()
            } finally {
                gate.countDown()
            }
        }
        return true
    }

    /**
     * 取出待处理图片。复制尚未完成时会短暂等待；等待超时返回空，复制完成事件会再唤醒 JS。
     * 成功或失败的结果都只交付一次，避免同一条分享被识别两遍。
     */
    fun take(context: Context): TakeResult {
        val waiting = synchronized(lock) { latch }
        if (waiting != null) {
            try {
                waiting.await(WAIT_SECONDS, TimeUnit.SECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }

        synchronized(lock) {
            val image = result ?: readPersisted(context)
            val error = failure
            result = null
            failure = null
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(KEY_PATH)
                .remove(KEY_MIME)
                .apply()

            if (image != null) {
                val path = Uri.parse(image.uri).path
                if (path != null && File(path).exists()) {
                    return TakeResult(image, error)
                }
                return TakeResult(null, error ?: "分享的图片已失效，请重新分享")
            }
            return TakeResult(null, error)
        }
    }

    private fun notifyReady() {
        for (listener in listeners) {
            try {
                listener()
            } catch (cause: Throwable) {
                Log.w(TAG, "通知 JS 分享图片失败", cause)
            }
        }
    }

    private fun readPersisted(context: Context): ShareImage? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val uri = prefs.getString(KEY_PATH, null) ?: return null
        return ShareImage(uri, prefs.getString(KEY_MIME, null))
    }

    private fun sharedUri(intent: Intent): Uri? {
        val stream = intent.extras?.get(Intent.EXTRA_STREAM)
        if (stream is Uri) {
            return stream
        }
        if (stream is List<*>) {
            stream.firstOrNull { it is Uri }?.let { return it as Uri }
        }
        val clip = intent.clipData ?: return null
        for (index in 0 until clip.itemCount) {
            clip.getItemAt(index).uri?.let { return it }
        }
        return null
    }

    private fun copyToCache(context: Context, source: Uri, mimeType: String?): File {
        val extension = when (mimeType?.lowercase()) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/heic", "image/heif" -> "heic"
            else -> "jpg"
        }
        val target = File(
            context.cacheDir,
            "$FILE_PREFIX${System.currentTimeMillis()}.$extension",
        )
        val input = context.contentResolver.openInputStream(source)
            ?: throw IOException("无法打开分享的图片")
        try {
            input.use { stream ->
                FileOutputStream(target).use { output -> stream.copyTo(output) }
            }
        } catch (cause: Throwable) {
            target.delete()
            throw cause
        }
        if (target.length() <= 0L) {
            target.delete()
            throw IOException("分享的图片是空文件")
        }
        return target
    }

    private fun cleanupOldFiles(context: Context) {
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        context.cacheDir.listFiles()
            ?.filter { it.name.startsWith(FILE_PREFIX) && it.lastModified() < cutoff }
            ?.forEach { it.delete() }
    }
}

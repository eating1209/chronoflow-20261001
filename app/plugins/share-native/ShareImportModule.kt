package com.chronoflow.frontend

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** 把系统分享进来的图片交给 JS：只暴露「取一张待处理图片」这一件事。 */
class ShareImportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "ChronoflowShareImport"
        const val EVENT_READY = "chronoflow.share.imageReady"
    }

    private val removeListener = SharedImageBridge.addListener {
        reactApplicationContext.runOnUiQueueThread {
            try {
                reactApplicationContext.emitDeviceEvent(EVENT_READY, Arguments.createMap())
            } catch (_: Throwable) {
                // JS 已退出或桥未就绪时，图片仍留在本地缓存，下次启动会再取。
            }
        }
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun consumeImage(promise: Promise) {
        try {
            val result = SharedImageBridge.take(reactApplicationContext)
            if (result.image == null && result.error == null) {
                promise.resolve(null)
                return
            }
            val payload = Arguments.createMap().apply {
                result.image?.let { image ->
                    putString("uri", image.uri)
                    putString("mimeType", image.mimeType)
                }
                result.error?.let { putString("error", it) }
            }
            promise.resolve(payload)
        } catch (cause: Throwable) {
            promise.reject(
                "E_SHARE_IMPORT",
                cause.message ?: "读取分享图片失败",
                cause,
            )
        }
    }

    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) = Unit

    override fun invalidate() {
        removeListener()
        super.invalidate()
    }
}

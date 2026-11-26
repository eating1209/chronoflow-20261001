package com.chronoflow.frontend

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * 任务栏 / 锁屏常驻任务总览。
 *
 * <p>通知卡和顶部悬浮小条共用同一份状态。通知本身是普通持续通知；顶部小条是单独开关，
 * 只有用户主动授权“显示在其他应用上层”后才会启动，不会默认覆盖其它 App。
 * 卡片上的色段、圆圈和箭头都有各自的入口，完成后先在本地立即更新，同时把待同步动作排队，
 * 等 App 回到前台再调用服务端。
 */
class TaskBarNotificationModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "ChronoflowTaskBar"
        const val EVENT_COMPLETED = "chronoflow.taskbar.completed"

        @Volatile
        private var active: TaskBarNotificationModule? = null

        /** 通知接收器完成了一条任务；App 在前台时顺手通知 JS，让它立刻拉服务端。 */
        internal fun notifyCompletion(action: TaskBarNotificationCore.CompletedAction) {
            val module = active ?: return
            try {
                module.emitCompletion(action)
            } catch (_: Exception) {
                // JS 已经退出或桥还没准备好时只保留本地队列，不能影响通知本身。
            }
        }
    }

    init {
        active = this
    }

    override fun getName(): String = NAME

    override fun invalidate() {
        if (active === this) {
            active = null
        }
        super.invalidate()
    }

    @ReactMethod
    fun update(payloadJson: String, promise: Promise) {
        try {
            promise.resolve(TaskBarNotificationCore.storePayload(reactApplicationContext, payloadJson))
        } catch (error: Exception) {
            promise.reject("E_TASKBAR_NOTIFICATION", error.message ?: "任务总览通知更新失败", error)
        }
    }

    @ReactMethod
    fun clear(promise: Promise) {
        try {
            TaskBarNotificationCore.clear(reactApplicationContext)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("E_TASKBAR_NOTIFICATION", error.message ?: "任务总览通知取消失败", error)
        }
    }

    @ReactMethod
    fun isPermissionGranted(promise: Promise) {
        promise.resolve(TaskBarNotificationCore.isPermissionGranted(reactApplicationContext))
    }

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        promise.resolve(Settings.canDrawOverlays(reactApplicationContext))
    }

    @ReactMethod
    fun hasUsageAccess(promise: Promise) {
        promise.resolve(hasUsageAccess(reactApplicationContext))
    }

    /** 打开“使用情况访问”授权页；返回 App 后由 JS 重新检查。 */
    @ReactMethod
    fun requestUsageAccess(promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val activity = context.currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                context.startActivity(intent)
            }
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject(
                "E_TASKBAR_USAGE_ACCESS",
                error.message ?: "无法打开使用情况访问页",
                error,
            )
        }
    }

    @ReactMethod
    fun isOverlayEnabled(promise: Promise) {
        val context = reactApplicationContext
        promise.resolve(
            Settings.canDrawOverlays(context) &&
                TaskBarNotificationCore.isOverlayWanted(context),
        )
    }

    /** 跳系统授权页；用户返回后由 JS 再调用 startOverlay。 */
    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}"),
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val activity = reactApplicationContext.currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                context.startActivity(intent)
            }
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject(
                "E_TASKBAR_OVERLAY_PERMISSION",
                error.message ?: "无法打开悬浮窗授权页",
                error,
            )
        }
    }

    @ReactMethod
    fun startOverlay(promise: Promise) {
        try {
            val context = reactApplicationContext
            if (!Settings.canDrawOverlays(context)) {
                promise.resolve(false)
                return
            }
            TaskBarNotificationCore.setOverlayWanted(context, true)
            TaskBarOverlayService.start(context)
            promise.resolve(true)
        } catch (error: Exception) {
            TaskBarNotificationCore.setOverlayWanted(reactApplicationContext, false)
            promise.reject(
                "E_TASKBAR_OVERLAY_START",
                error.message ?: "顶部任务小条启动失败",
                error,
            )
        }
    }

    @ReactMethod
    fun stopOverlay(promise: Promise) {
        try {
            val context = reactApplicationContext
            TaskBarNotificationCore.setOverlayWanted(context, false)
            TaskBarOverlayService.stop(context)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject(
                "E_TASKBAR_OVERLAY_STOP",
                error.message ?: "顶部任务小条关闭失败",
                error,
            )
        }
    }

    /** JS 启动 / 回到前台时读取本地待同步完成动作；网络失败就留到下次。 */
    @ReactMethod
    fun pendingCompletions(promise: Promise) {
        try {
            promise.resolve(TaskBarNotificationCore.pendingJson(reactApplicationContext))
        } catch (error: Exception) {
            promise.reject("E_TASKBAR_NOTIFICATION", error.message ?: "读取待同步任务失败", error)
        }
    }

    /** 服务端确认成功后，按 key 删除本地队列，避免重复提交。 */
    @ReactMethod
    fun ackCompletions(keysJson: String, promise: Promise) {
        try {
            TaskBarNotificationCore.acknowledge(reactApplicationContext, keysJson)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("E_TASKBAR_NOTIFICATION", error.message ?: "确认待同步任务失败", error)
        }
    }

    /** 给测试包排查用：原生模块是否存在、最后一次渲染错误、通知权限。 */
    @ReactMethod
    fun diagnostics(promise: Promise) {
        try {
            val payload = org.json.JSONObject().apply {
                put("module", NAME)
                put("lastError", TaskBarNotificationCore.lastError(reactApplicationContext) ?: "")
                put("permission", TaskBarNotificationCore.isPermissionGranted(reactApplicationContext))
                put("overlayPermission", Settings.canDrawOverlays(reactApplicationContext))
            put("usageAccess", hasUsageAccess(reactApplicationContext))
                put("overlayWanted", TaskBarNotificationCore.isOverlayWanted(reactApplicationContext))
                put("overlayRunning", TaskBarOverlayService.isRunning())
                put("overlayAttached", TaskBarOverlayService.isAttached())
                put("overlayRecoveryCount", TaskBarOverlayService.recoveryCount())
                put("overlayLastRecoveryAt", TaskBarOverlayService.lastRecoveryAt())
                put("overlayPresentation", TaskBarOverlayService.presentationName())
                put("launcherForeground", TaskBarOverlayService.isLauncherForeground())
                put("overlayRetryAttempts", TaskBarOverlayService.windowRetryAttempts())
                put("overlayLastWindowError", TaskBarOverlayService.lastWindowError())
                put("oemFamily", TaskBarOverlayService.oemFamily())
                put("manufacturer", android.os.Build.MANUFACTURER)
                put("brand", android.os.Build.BRAND)
                put("model", android.os.Build.MODEL)
                put("sdk", android.os.Build.VERSION.SDK_INT)
            }
            promise.resolve(payload.toString())
        } catch (error: Exception) {
            promise.reject("E_TASKBAR_NOTIFICATION", error.message ?: "任务总览诊断失败", error)
        }
    }

    /** NativeEventEmitter 兼容方法；实际事件通过 DeviceEventEmitter 发出。 */
    @ReactMethod
    fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit

    @ReactMethod
    fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Int) = Unit

    private fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java) ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName,
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun emitCompletion(action: TaskBarNotificationCore.CompletedAction) {
        val payload: WritableMap = Arguments.createMap().apply {
            putString("key", action.key)
            putString("kind", action.kind)
            putInt("id", action.id)
            putString("occurrenceDate", action.occurrenceDate)
            putString("completedAt", action.completedAt)
        }
        reactApplicationContext.emitDeviceEvent(EVENT_COMPLETED, payload)
    }
}

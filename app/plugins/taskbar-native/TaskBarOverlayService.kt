package com.chronoflow.frontend

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.AppOpsManager
import android.app.KeyguardManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.WindowInsets
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 视觉上贴住状态栏的三色任务小条，只在桌面等非 App 界面显示。
 *
 * <p>系统状态栏本身不允许第三方 App 往里塞可交互 View，所以窗口层仍在状态栏下方，
 * 只把黑色胶囊抬到状态栏这一行，时间与系统图标留在两侧。窗口本身只包住可见内容，
 * 不覆盖整行屏幕，避免透明区域抢走桌面图标的点击。
 * 收起时只占一条很窄的黑色胶囊；点一下展开白色任务卡，再点收起。
 * 勾选圆圈会同时更新通知、悬浮条和待同步队列，和锁屏卡片保持同一份状态。
 */
class TaskBarOverlayService : Service() {

    companion object {
        private const val TAG = "ChronoFlowTaskBar"
        private const val ACTION_STOP = "com.chronoflow.frontend.TASKBAR_OVERLAY_STOP"

        /** 用户把「顶部任务小条」通知上滑划掉时，直接关掉悬浮条。 */
        internal const val ACTION_DISMISS = "com.chronoflow.frontend.TASKBAR_OVERLAY_DISMISS"

        private const val CHANNEL_ID = "taskbar-overlay-service-v3"
        private const val NOTIFICATION_ID = 7312

        private const val COLOR_INK = 0xFF25262A.toInt()
        private const val COLOR_MUTED = 0xFF6B6B6B.toInt()
        private const val COLOR_TRACK = 0xFF3B3C40.toInt()
        private const val COLOR_URGENT = 0xFFB3352F.toInt()
        private const val COLOR_SOON = 0xFFB58500.toInt()
        private const val COLOR_CALM = 0xFF2E7D5B.toInt()

        /** 黑色胶囊抬到状态栏这一行，桌面/其他 App 都使用同一个视觉高度。 */
        private const val STATUS_BAR_OVERLAP_DP = 26

        /** 悬浮窗被系统临时摘掉时尽快重新挂回去，同时让桌面/其他 App 的切换更跟手。 */
        private const val WINDOW_WATCHDOG_MS = 400L

        /** 系统弹层（通知栏、权限弹窗等）收起后，等系统动画结束再重新置顶。 */
        private const val SYSTEM_UI_SETTLE_MS = 180L

        /** 展开任务卡后自动收回，避免一直挡着别的 App。 */
        private const val EXPANDED_AUTO_RETRACT_MS = 8_000L

        /** 按下 Home 后先按桌面处理，给任务栈识别留出系统切换时间。 */
        private const val HOME_ASSUME_MS = 6_000L

        /** 使用情况事件只用来发现“刚发生的切换”；当前场景由最近一次可靠结果保持。 */
        private const val USAGE_LOOKBACK_MS = 30_000L

        /** 窗口被厂商 ROM 暂时拒绝时退避重试，不把用户的悬浮条开关直接关掉。 */
        private const val WINDOW_RETRY_BASE_MS = 300L
        private const val WINDOW_RETRY_MAX_MS = 4_000L

        /** 视觉上仍是细条，但透明触摸区扩大到 40dp，避免手指点不中。 */
        private const val TOUCH_TARGET_HEIGHT_DP = 40
        private const val COMPACT_PILL_HEIGHT_DP = 14
        private const val FULL_PILL_HEIGHT_DP = 30

        /** 桌面完整胶囊：触摸区 48dp，视觉高度仍是 30dp。 */
        private const val FULL_TOUCH_TARGET_HEIGHT_DP = 48

        /** 桌面完整胶囊整体放在状态栏下方 4dp，避免触摸被系统状态栏截走。 */
        private const val FULL_PILL_TOP_GAP_DP = 4
        private const val HORIZONTAL_TOUCH_PADDING_DP = 12

        @Volatile
        private var active: TaskBarOverlayService? = null

        @Volatile
        private var recoveryCount: Int = 0

        @Volatile
        private var lastRecoveryAt: Long = 0L

        @Volatile
        private var lastWindowError: String = ""

        internal fun start(context: Context) {
            val intent = Intent(context, TaskBarOverlayService::class.java)
            // 调用点都在 App 前台（用户刚点了开关，或从授权页返回）。
            // 不用 startForegroundService：万一某些 ROM 拒绝 startForeground，
            // 系统会在 5 秒后追加一次“未调用 startForeground”的进程崩溃。
            // 普通 startService + 服务内 startForeground 的失败可由我们自己兜住。
            context.startService(intent)
        }

        internal fun stop(context: Context) {
            context.stopService(Intent(context, TaskBarOverlayService::class.java))
        }

        internal fun isRunning(): Boolean = active != null

        internal fun isAttached(): Boolean = active?.rootView?.isAttachedToWindow == true

        internal fun recoveryCount(): Int = recoveryCount

        internal fun lastRecoveryAt(): Long = lastRecoveryAt

        internal fun lastWindowError(): String = lastWindowError

        internal fun presentationName(): String =
            active?.presentation?.name?.lowercase() ?: "none"

        internal fun isLauncherForeground(): Boolean =
            active?.launcherForeground == true

        internal fun windowRetryAttempts(): Int = active?.windowRetryAttempt ?: 0

        /** 只用于诊断上报，不参与业务判断；各 ROM 的窗口限制由运行时策略处理。 */
        internal fun oemFamily(): String {
            val value = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
            return when {
                "huawei" in value || "honor" in value -> "huawei"
                "xiaomi" in value || "redmi" in value || "poco" in value -> "xiaomi"
                "oppo" in value || "realme" in value || "oneplus" in value -> "oppo"
                "vivo" in value || "iqoo" in value -> "vivo"
                "samsung" in value -> "samsung"
                else -> "other"
            }
        }

        /** 通知内容更新时由 core 调用；主线程重建小条，避免 RemoteViews 与 View 状态不同步。 */
        internal fun refresh(context: Context) {
            val service = active ?: return
            Handler(Looper.getMainLooper()).post {
                if (active === service) {
                    service.render()
                }
            }
        }
    }

    private var windowManager: WindowManager? = null
    private var rootView: View? = null
    private var expanded = false
    private var selectedGroupKey: String? = null
    private var presentation = Presentation.FULL
    private var launcherForeground = false
    private var launcherAssumedUntil = 0L
    private var launcherAssumedAfterWall = 0L
    private var observedScene = ForegroundScene.UNKNOWN
    private var usageForeground: String? = null
    private var usageForegroundAt = 0L
    private var usageCachedScene: ForegroundScene? = null
    private var usageCheckedAt = 0L
    private var lastLoggedScene = ForegroundScene.UNKNOWN
    private var windowRetryAttempt = 0
    private var windowRetryScheduled = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var reassertGeneration = 0

    private enum class Presentation {
        COMPACT,
        FULL,
    }

    private enum class ForegroundScene {
        LAUNCHER,
        OTHER_APP,
        UNKNOWN,
    }

    private val watchdogRunnable = object : Runnable {
        override fun run() {
            if (active !== this@TaskBarOverlayService) {
                return
            }
            syncPresentation()
            ensureWindowAttached()
            mainHandler.postDelayed(this, WINDOW_WATCHDOG_MS)
        }
    }

    private val autoRetractRunnable = object : Runnable {
        override fun run() {
            if (active !== this@TaskBarOverlayService || !expanded) {
                return
            }
            expanded = false
            render()
        }
    }

    private val windowRetryRunnable = object : Runnable {
        override fun run() {
            windowRetryScheduled = false
            if (active !== this@TaskBarOverlayService) {
                return
            }
            if (!shouldShowOverlay()) {
                removeWindow()
                return
            }
            render()
        }
    }

    private val screenStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_CLOSE_SYSTEM_DIALOGS -> {
                    val reason = intent.getStringExtra("reason")
                    if (reason.isNullOrBlank() || reason == "homekey") {
                        showDesktopCapsule()
                    }
                    scheduleWindowReassert()
                }
                Intent.ACTION_CONFIGURATION_CHANGED -> scheduleRender(0L)
                Intent.ACTION_USER_PRESENT -> {
                    scheduleRender(0L)
                    scheduleWindowReassert(SYSTEM_UI_SETTLE_MS)
                }
                else -> render()
            }
        }
    }

    private val lifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

        override fun onActivityStarted(activity: Activity) = Unit

        override fun onActivityResumed(activity: Activity) {
            render()
        }

        override fun onActivityPaused(activity: Activity) {
            scheduleRender()
        }

        override fun onActivityStopped(activity: Activity) {
            scheduleRender(0L)
            scheduleWindowReassert(SYSTEM_UI_SETTLE_MS)
        }

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    override fun onCreate() {
        super.onCreate()
        active = this
        lastWindowError = ""
        try {
            ensureChannel()
            startForegroundCompat()
        } catch (error: Throwable) {
            // Android 14/15 对 specialUse 前台服务、通知渠道和部分 ROM 的厂商策略
            // 都可能在 startForeground 时抛异常。它发生在主线程，不兜住就是整个
            // App 闪退。这里只关闭悬浮条，通知卡和其他功能继续可用。
            lastWindowError = "startForeground: ${error.javaClass.simpleName}: ${error.message ?: "unknown"}"
            Log.e(TAG, "无法启动顶部小条前台服务", error)
            TaskBarNotificationCore.setOverlayWanted(this, false)
            if (active === this) {
                active = null
            }
            stopSelf()
            return
        }
        try {
            (application as? Application)?.registerActivityLifecycleCallbacks(lifecycleCallbacks)
            ContextCompat.registerReceiver(
                this,
                screenStateReceiver,
                IntentFilter().apply {
                    addAction(Intent.ACTION_SCREEN_OFF)
                    addAction(Intent.ACTION_SCREEN_ON)
                    addAction(Intent.ACTION_USER_PRESENT)
                    addAction(Intent.ACTION_CLOSE_SYSTEM_DIALOGS)
                    addAction(Intent.ACTION_CONFIGURATION_CHANGED)
                },
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            if (!Settings.canDrawOverlays(this)) {
                TaskBarNotificationCore.setOverlayWanted(this, false)
                stopSelf()
                return
            }
            showWindow()
            startWatchdog()
        } catch (error: Throwable) {
            lastWindowError = "serviceInit: ${error.javaClass.simpleName}: ${error.message ?: "unknown"}"
            Log.e(TAG, "顶部小条初始化失败", error)
            TaskBarNotificationCore.setOverlayWanted(this, false)
            removeWindow()
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!Settings.canDrawOverlays(this)) {
            TaskBarNotificationCore.setOverlayWanted(this, false)
            stopSelf()
            return START_NOT_STICKY
        }
        render()
        startWatchdog()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        try {
            unregisterReceiver(screenStateReceiver)
        } catch (_: Exception) {
            // 服务被系统提前回收时 receiver 可能已经解绑。
        }
        (application as? Application)?.unregisterActivityLifecycleCallbacks(lifecycleCallbacks)
        removeWindow()
        if (active === this) {
            active = null
        }
        super.onDestroy()
    }

    private fun showWindow() {
        val manager = getSystemService(WINDOW_SERVICE) as? WindowManager ?: run {
            stopSelf()
            return
        }
        windowManager = manager
        render()
    }

    private fun render() {
        try {
            renderNow()
        } catch (error: Throwable) {
            // 任何 ROM 的 RemoteViews / 窗口行为差异都不应该把 App 进程带走。
            lastWindowError = "render: ${error.javaClass.simpleName}: ${error.message ?: "unknown"}"
            Log.e(TAG, "顶部小条渲染失败", error)
            expanded = false
            removeWindow()
            scheduleWindowRetry()
        }
    }

    private fun renderNow() {
        if (!Settings.canDrawOverlays(this)) {
            TaskBarNotificationCore.setOverlayWanted(this, false)
            stopSelf()
            return
        }
        if (!shouldShowOverlay()) {
            expanded = false
            removeWindow()
            return
        }
        val manager = windowManager ?: return
        val desired = desiredPresentation()
        if (desired == Presentation.COMPACT) {
            expanded = false
            mainHandler.removeCallbacks(autoRetractRunnable)
        }
        presentation = desired
        val state = TaskBarNotificationCore.overlayState(this)
        val selected = state?.groups
            ?.firstOrNull { it.key == selectedGroupKey && it.count > 0 }
            ?: state?.groups?.firstOrNull { it.count > 0 }
        selectedGroupKey = selected?.key

        val next = buildRoot(state)
        val old = rootView
        try {
            old?.let { manager.removeView(it) }
        } catch (_: Exception) {
            // Activity 切换或权限被回收时 View 可能已经不在 WindowManager 里。
        }
        try {
            manager.addView(next, windowParams())
            rootView = next
            windowRetryAttempt = 0
            windowRetryScheduled = false
            lastWindowError = ""
            mainHandler.removeCallbacks(windowRetryRunnable)
        } catch (error: Exception) {
            rootView = null
            // ColorOS / OriginOS / HyperOS 在通知栏刚收起、切屏动画未结束时可能短暂拒绝
            // addView。此前这里会直接关掉用户开关，表现成“其他手机怎么都打不开”；
            // 现在保留开关，按退避间隔重试，权限被回收时才在 render 开头停服务。
            lastWindowError = "${error.javaClass.simpleName}: ${error.message ?: "unknown"}"
            scheduleWindowRetry()
        }
    }

    private fun scheduleWindowRetry() {
        if (windowRetryScheduled) {
            return
        }
        windowRetryAttempt += 1
        val shift = (windowRetryAttempt - 1).coerceIn(0, 4)
        val delay = (WINDOW_RETRY_BASE_MS shl shift).coerceAtMost(WINDOW_RETRY_MAX_MS)
        windowRetryScheduled = true
        mainHandler.postDelayed(windowRetryRunnable, delay)
    }

    private fun removeWindow() {
        val manager = windowManager
        val view = rootView
        if (manager != null && view != null) {
            try {
                manager.removeView(view)
            } catch (_: Exception) {
                // 权限被回收后 removeView 也可能失败，忽略即可。
            }
        }
        rootView = null
    }

    private fun scheduleRender(delayMs: Long = 60L) {
        mainHandler.postDelayed({
            if (active === this) {
                render()
            }
        }, delayMs)
    }

    /**
     * 系统弹层收起后重新挂一次窗口。
     *
     * <p>Android 不会告诉普通悬浮窗“你刚被哪个系统窗口盖住了”，也不会在对方消失时回调。
     * 通知栏 / 权限弹窗关闭时会发 CLOSE_SYSTEM_DIALOGS，借这个时机把窗口重新放到
     * 应用悬浮层顶部；只重建一次，避免定时 remove/add 造成闪烁。
     */
    private fun scheduleWindowReassert(delayMs: Long = SYSTEM_UI_SETTLE_MS) {
        val generation = ++reassertGeneration
        mainHandler.postDelayed({
            if (active !== this@TaskBarOverlayService || generation != reassertGeneration) {
                return@postDelayed
            }
            if (!Settings.canDrawOverlays(this) || !TaskBarNotificationCore.isOverlayWanted(this)) {
                return@postDelayed
            }
            if (!shouldShowOverlay()) {
                expanded = false
                removeWindow()
                return@postDelayed
            }
            recordRecovery()
            render()
        }, delayMs)
    }

    /** 只处理“窗口真的被系统摘掉”的情况，不处理仅被遮挡的情况，避免无意义闪烁。 */
    private fun ensureWindowAttached() {
        if (!Settings.canDrawOverlays(this)) {
            TaskBarNotificationCore.setOverlayWanted(this, false)
            stopSelf()
            return
        }
        if (!TaskBarNotificationCore.isOverlayWanted(this)) {
            return
        }
        if (!shouldShowOverlay()) {
            if (rootView != null) {
                expanded = false
                removeWindow()
            }
            return
        }
        val current = rootView
        if (current == null || !current.isAttachedToWindow) {
            recordRecovery()
            render()
        }
    }

    /**
     * 桌面显示原胶囊；其他 App 里默认缩成细条。
     *
     * <p>使用情况事件负责发现 App 切换，并保留最近一次可靠场景；任务栈和进程列表
     * 只补“当前在桌面”的证据。这样旧 App 的历史事件不会在回到桌面 6 秒后又把
     * 胶囊缩成细条。判断不出来时保持原胶囊。
     */
    private fun desiredPresentation(): Presentation {
        val scene = if (SystemClock.elapsedRealtime() < launcherAssumedUntil) {
            observedScene = ForegroundScene.LAUNCHER
            ForegroundScene.LAUNCHER
        } else {
            foregroundScene()
        }
        if (scene != lastLoggedScene) {
            lastLoggedScene = scene
            Log.d(TAG, "前台场景=$scene usage=${usageForeground ?: "-"}")
        }
        launcherForeground = scene == ForegroundScene.LAUNCHER
        // 其它应用内才缩成细条；桌面和暂时判断不出来时保持原胶囊，避免回桌面时先闪一下细条。
        return if (scene == ForegroundScene.OTHER_APP) {
            Presentation.COMPACT
        } else {
            Presentation.FULL
        }
    }

    /** Home 键会先于使用情况统计生效；直接切回原胶囊，避免先露出细条再变回来。 */
    private fun showDesktopCapsule() {
        val now = SystemClock.elapsedRealtime()
        launcherAssumedUntil = now + HOME_ASSUME_MS
        launcherAssumedAfterWall = System.currentTimeMillis()
        observedScene = ForegroundScene.LAUNCHER
        launcherForeground = true
        presentation = Presentation.FULL
        expanded = false
        mainHandler.removeCallbacks(autoRetractRunnable)
        scheduleRender(0L)
    }

    private fun syncPresentation() {
        if (!shouldShowOverlay()) {
            return
        }
        val next = desiredPresentation()
        if (next == presentation) {
            return
        }
        presentation = next
        if (next == Presentation.COMPACT) {
            expanded = false
            mainHandler.removeCallbacks(autoRetractRunnable)
        }
        render()
    }

    private fun foregroundScene(): ForegroundScene {
        val homePackages = resolveHomePackages()
        if (homePackages.isEmpty()) {
            return ForegroundScene.UNKNOWN
        }
        val activityManager = getSystemService(ActivityManager::class.java)
            ?: return ForegroundScene.UNKNOWN

        val hasUsage = hasUsageAccess()
        val usageScene = if (hasUsage) recentUsageScene(homePackages) else null
        if (usageScene != null) {
            observedScene = usageScene
        }

        // 有使用情况权限时，App 切换事件比任务栈更可靠。任务栈和进程列表只用来
        // 补出“当前确实在桌面”的证据，不能再把已经确认的桌面翻回细条。
        if (hasUsage) {
            val topTask = topTaskPackage(activityManager)
            if (topTask != null && isLauncherPackage(topTask, homePackages)) {
                observedScene = ForegroundScene.LAUNCHER
            } else if (usageScene == null && observedScene == ForegroundScene.UNKNOWN) {
                classifyForegroundPackage(topTask, homePackages)?.let {
                    observedScene = it
                }
            }
            val processScene = foregroundProcessScene(activityManager, homePackages)
            if (processScene == ForegroundScene.LAUNCHER) {
                observedScene = ForegroundScene.LAUNCHER
            } else if (usageScene == null && observedScene == ForegroundScene.UNKNOWN) {
                observedScene = processScene ?: ForegroundScene.UNKNOWN
            }
            return observedScene
        }

        val topScene = classifyForegroundPackage(
            topTaskPackage(activityManager),
            homePackages,
        )
        // 没有使用情况权限时，进程列表可能把桌面的常驻进程误当成前台 App。
        // 只有任务栈确认在桌面才据此展开；其他情况保持原胶囊，宁可少缩一次，
        // 也不能在桌面反复闪成细条。
        if (topScene == ForegroundScene.LAUNCHER) {
            return ForegroundScene.LAUNCHER
        }
        if (foregroundProcessScene(activityManager, homePackages) == ForegroundScene.LAUNCHER) {
            return ForegroundScene.LAUNCHER
        }
        return ForegroundScene.UNKNOWN
    }

    private fun foregroundProcessScene(
        activityManager: ActivityManager,
        homePackages: Set<String>,
    ): ForegroundScene? {
        val processes = activityManager.runningAppProcesses ?: return ForegroundScene.UNKNOWN
        if (processes.size <= 1) {
            // 部分系统只返回时纪流自己的进程；判断不出场景时保持原胶囊。
            return null
        }
        val foreground = processes.filter {
            it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }
        if (foreground.isEmpty()) {
            return null
        }
        val homeInFront = foreground.any {
            isLauncherPackage(processPackage(it.processName), homePackages)
        }
        val otherAppInFront = foreground.any { process ->
            val name = processPackage(process.processName)
            !isLauncherPackage(name, homePackages) &&
                name != packageName &&
                !isSystemUiPackage(name) &&
                isLaunchablePackage(name)
        }
        return when {
            otherAppInFront -> ForegroundScene.OTHER_APP
            homeInFront -> ForegroundScene.LAUNCHER
            else -> null
        }
    }

    private fun classifyForegroundPackage(
        foregroundPackage: String?,
        homePackages: Set<String>,
    ): ForegroundScene? = when {
        foregroundPackage == null -> null
        isLauncherPackage(foregroundPackage, homePackages) -> ForegroundScene.LAUNCHER
        foregroundPackage == packageName || isSystemUiPackage(foregroundPackage) -> null
        else -> ForegroundScene.OTHER_APP
    }

    private fun resolveHomePackages(): Set<String> {
        val packages = mutableSetOf<String>()
        val homeIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        packageManager
            .queryIntentActivities(homeIntent, PackageManager.MATCH_DEFAULT_ONLY)
            .forEach { info ->
                info.activityInfo?.packageName?.let { packages.add(it) }
            }
        packageManager
            .resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo
            ?.packageName
            ?.let { packages.add(it) }
        return packages
    }

    private fun isLauncherPackage(
        candidate: String,
        homePackages: Set<String>,
    ): Boolean = candidate in homePackages ||
        candidate == "com.miui.home" ||
        candidate.contains("launcher", ignoreCase = true)

    @Suppress("DEPRECATION")
    private fun topTaskPackage(activityManager: ActivityManager): String? {
        return try {
            activityManager.getRunningTasks(6)
                .firstOrNull { it.topActivity != null }
                ?.topActivity
                ?.packageName
        } catch (_: SecurityException) {
            null
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * Android 14+ 上进程列表经常只剩自己，使用情况访问是唯一稳定能看到前台应用的方式。
     *
     * <p>这里按事件顺序还原最后一次切换。除了“新 App 恢复前台”，也处理“旧 App
     * 退到后台”：部分桌面不记录自己的恢复事件，但旧 App 的暂停事件仍会到达。
     */
    private fun recentUsageScene(homePackages: Set<String>): ForegroundScene? {
        val now = SystemClock.elapsedRealtime()
        if (now - usageCheckedAt < 200L) {
            return usageCachedScene
        }
        usageCheckedAt = now
        if (!hasUsageAccess()) {
            usageForeground = null
            usageCachedScene = null
            return null
        }
        val manager = getSystemService(UsageStatsManager::class.java) ?: return null
        val end = System.currentTimeMillis()
        val start = maxOf(end - USAGE_LOOKBACK_MS, launcherAssumedAfterWall)
        if (start >= end) {
            usageCachedScene = null
            return null
        }
        val events = try {
            manager.queryEvents(start, end)
        } catch (_: Throwable) {
            null
        } ?: return null
        val event = UsageEvents.Event()
        val resumedType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            UsageEvents.Event.ACTIVITY_RESUMED
        } else {
            @Suppress("DEPRECATION")
            UsageEvents.Event.MOVE_TO_FOREGROUND
        }
        val pausedType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            UsageEvents.Event.ACTIVITY_PAUSED
        } else {
            @Suppress("DEPRECATION")
            UsageEvents.Event.MOVE_TO_BACKGROUND
        }
        var scene: ForegroundScene? = null
        var currentPackage: String? = null
        var latestAt = 0L
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            when (event.eventType) {
                resumedType -> {
                    if (isSystemUiPackage(event.packageName)) {
                        continue
                    }
                    currentPackage = event.packageName
                    latestAt = event.timeStamp
                    scene = when {
                        isLauncherPackage(event.packageName, homePackages) ->
                            ForegroundScene.LAUNCHER
                        event.packageName == packageName -> ForegroundScene.UNKNOWN
                        else -> ForegroundScene.OTHER_APP
                    }
                }
                pausedType -> {
                    if (event.packageName == currentPackage) {
                        currentPackage = null
                        latestAt = event.timeStamp
                        scene = ForegroundScene.UNKNOWN
                    }
                }
            }
        }
        usageForeground = currentPackage
        usageForegroundAt = latestAt
        usageCachedScene = scene
        return scene
    }

    private fun hasUsageAccess(): Boolean {
        val appOps = getSystemService(AppOpsManager::class.java) ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName,
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName,
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun processPackage(processName: String): String = processName.substringBefore(':')

    private fun isSystemUiPackage(packageName: String): Boolean =
        packageName == "com.android.systemui" ||
            packageName == "com.android.settings" ||
            packageName == "com.android.phone" ||
            packageName == "android" ||
            packageName == "com.google.android.gms" ||
            packageName == "com.google.android.gsf" ||
            packageName == "com.android.setupwizard" ||
            packageName == "com.google.android.setupwizard" ||
            packageName == "com.google.android.apps.restore" ||
            packageName.contains("permissioncontroller") ||
            packageName.contains("packageinstaller")

    private fun isLaunchablePackage(packageName: String): Boolean {
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(packageName)
        return packageManager.queryIntentActivities(intent, 0).isNotEmpty()
    }

    private fun startWatchdog() {
        mainHandler.removeCallbacks(watchdogRunnable)
        mainHandler.postDelayed(watchdogRunnable, WINDOW_WATCHDOG_MS)
    }

    private fun recordRecovery() {
        lastRecoveryAt = System.currentTimeMillis()
        recoveryCount += 1
    }

    /**
     * 顶部小条只在桌面等非 App 界面显示。
     *
     * <p>锁屏、息屏和时纪流自己在前台时都移除窗口；锁屏只显示通知卡，不显示悬浮条。
     * 服务本身继续运行，这样回到桌面或解锁后可以立即恢复，不需要用户重新授权。
     */
    private fun shouldShowOverlay(): Boolean {
        val power = getSystemService(PowerManager::class.java)
        if (power?.isInteractive == false) {
            return false
        }
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard?.isKeyguardLocked == true) {
            return false
        }
        val activityManager = getSystemService(ActivityManager::class.java) ?: return true
        val process = activityManager.runningAppProcesses
            ?.firstOrNull { it.processName == packageName }
        return process?.importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    private fun windowParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        return WindowManager.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            val topInset = statusBarInsetPx()
            val compact = presentation == Presentation.COMPACT
            val touchHeight = dp(if (compact) TOUCH_TARGET_HEIGHT_DP else FULL_TOUCH_TARGET_HEIGHT_DP)
            val pillHeight = dp(if (compact) COMPACT_PILL_HEIGHT_DP else FULL_PILL_HEIGHT_DP)
            val touchPadding = (touchHeight - pillHeight) / 2
            val pillTop = if (compact) {
                // 其他 App 内的细条保持贴状态栏，只用于展示和上滑关闭。
                (topInset - dp(STATUS_BAR_OVERLAP_DP)).coerceAtLeast(dp(4))
            } else {
                // 桌面完整胶囊下移到状态栏下方，整块触摸区都能收到点击。
                topInset + dp(FULL_PILL_TOP_GAP_DP)
            }
            // 窗口高度包含透明触摸区，y 要往上扣掉这段 padding，视觉胶囊才会真正更高。
            y = (pillTop - touchPadding).coerceAtLeast(0)
            title = "时纪流顶部任务条"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }

    private fun buildRoot(state: TaskBarNotificationCore.OverlayState?): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // 水平方向不留透明 padding：窗口有多宽，可点击区域就只有多宽。
            setPadding(0, 0, 0, 0)
        }
        if (presentation == Presentation.COMPACT) {
            root.addView(
                buildCompactBar(state),
                LinearLayout.LayoutParams(
                    compactBarWidth() + dp(HORIZONTAL_TOUCH_PADDING_DP * 2),
                    dp(TOUCH_TARGET_HEIGHT_DP),
                ).apply { gravity = Gravity.CENTER_HORIZONTAL },
            )
            return root
        }
        root.addView(
            buildCollapsedBar(state),
            LinearLayout.LayoutParams(
                collapsedBarWidth() + dp(HORIZONTAL_TOUCH_PADDING_DP * 2),
                dp(FULL_TOUCH_TARGET_HEIGHT_DP),
            ).apply { gravity = Gravity.CENTER_HORIZONTAL },
        )
        if (expanded) {
            root.addView(
                buildExpandedCard(state),
                LinearLayout.LayoutParams(
                    expandedCardWidth(),
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(6) },
            )
        }
        return root
    }

    private fun buildCollapsedBar(state: TaskBarNotificationCore.OverlayState?): View {
        val touch = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                collapsedBarWidth() + dp(HORIZONTAL_TOUCH_PADDING_DP * 2),
                dp(FULL_TOUCH_TARGET_HEIGHT_DP),
            )
            isClickable = true
            contentDescription = if (expanded) "收起时纪流任务条" else "展开时纪流任务条"
        }
        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            background = rounded(COLOR_INK, 13f)
            isClickable = true
        }

        // 点一下展开/收起；向左滑或向上滑直接关掉小条（不用再进 App 找开关）。
        var downX = 0f
        var downY = 0f
        val threshold = dp(36)
        val gesture = View.OnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    val leftSwipe = dx <= -threshold && abs(dx) >= abs(dy)
                    val upSwipe = dy <= -threshold && abs(dy) > abs(dx)
                    if (leftSwipe || upSwipe) {
                        TaskBarNotificationCore.setOverlayWanted(this, false)
                        stopSelf()
                    } else if (abs(dx) < dp(16) && abs(dy) < dp(16)) {
                        handleBarTap()
                    }
                    true
                }
                else -> true
            }
        }
        touch.setOnTouchListener(gesture)
        pill.setOnTouchListener(gesture)
        touch.addView(
            pill,
            FrameLayout.LayoutParams(
                collapsedBarWidth(),
                dp(FULL_PILL_HEIGHT_DP),
                Gravity.CENTER,
            ),
        )

        pill.addView(
            label("时纪流", 10f, 0xFFFFFFFF.toInt(), true),
        )
        pill.addView(
            buildMiniDistribution(state),
            LinearLayout.LayoutParams(0, dp(3), 1f).apply {
                marginStart = dp(7)
                marginEnd = dp(7)
            },
        )
        pill.addView(
            label("${state?.total ?: 0} 项", 10f, 0xE6FFFFFF.toInt(), true),
        )
        return touch
    }

    /** 其他 App 内的轻量形态：只显示三色比例和任务数，不响应点击，仅保留上滑关闭。 */
    private fun buildCompactBar(state: TaskBarNotificationCore.OverlayState?): View {
        val touch = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                compactBarWidth() + dp(HORIZONTAL_TOUCH_PADDING_DP * 2),
                dp(TOUCH_TARGET_HEIGHT_DP),
            )
            isClickable = false
            contentDescription = "时纪流三色任务概览，上滑可关闭"
        }
        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(9), 0, dp(9), 0)
            background = rounded(0xD925262A.toInt(), 9f)
            isClickable = false
        }

        var downX = 0f
        var downY = 0f
        val threshold = dp(36)
        val gesture = View.OnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    val leftSwipe = dx <= -threshold && abs(dx) >= abs(dy)
                    val upSwipe = dy <= -threshold && abs(dy) > abs(dx)
                    if (leftSwipe || upSwipe) {
                        TaskBarNotificationCore.setOverlayWanted(this, false)
                        stopSelf()
                    }
                    true
                }
                else -> true
            }
        }
        touch.setOnTouchListener(gesture)
        pill.setOnTouchListener(gesture)
        touch.addView(
            pill,
            FrameLayout.LayoutParams(
                compactBarWidth(),
                dp(COMPACT_PILL_HEIGHT_DP),
                Gravity.CENTER,
            ),
        )
        pill.addView(
            buildMiniDistribution(state),
            LinearLayout.LayoutParams(0, dp(4), 1f),
        )
        pill.addView(
            label("${state?.total ?: 0}", 8.5f, 0xE6FFFFFF.toInt(), true).apply {
                setPadding(dp(7), 0, 0, 0)
            },
        )
        return touch
    }

    private fun handleBarTap() {
        if (expanded) {
            collapseExpanded()
            return
        }
        expanded = true
        mainHandler.removeCallbacks(autoRetractRunnable)
        mainHandler.postDelayed(autoRetractRunnable, EXPANDED_AUTO_RETRACT_MS)
        render()
    }

    private fun collapseExpanded() {
        expanded = false
        mainHandler.removeCallbacks(autoRetractRunnable)
        render()
    }

    private fun buildMiniDistribution(state: TaskBarNotificationCore.OverlayState?): View {
        val track = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = rounded(COLOR_TRACK, 2f)
        }
        val groups = state?.groups?.filter { it.count > 0 }.orEmpty()
        if (groups.isEmpty()) {
            track.addView(
                View(this).apply { setBackgroundColor(0x33FFFFFF) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)),
            )
            return track
        }
        groups.forEachIndexed { index, group ->
            track.addView(
                View(this).apply { background = rounded(colorFor(group.key), 2f) },
                LinearLayout.LayoutParams(0, dp(3), group.count.toFloat()).apply {
                    if (index < groups.lastIndex) {
                        marginEnd = dp(2)
                    }
                },
            )
        }
        return track
    }

    private fun buildExpandedCard(state: TaskBarNotificationCore.OverlayState?): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(11), dp(13), dp(10))
            background = rounded(0xFFFFFFFF.toInt(), 18f, 0x24000000)
            elevation = dp(8).toFloat()
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val headerText = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        headerText.addView(label("任务总览", 15f, COLOR_INK, true))
        headerText.addView(
            label(state?.headline ?: "暂时没有待办与日程", 10.5f, COLOR_MUTED),
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(2) },
        )
        header.addView(
            headerText,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        header.addView(
            label("收起", 10.5f, COLOR_MUTED, true).apply {
                setPadding(dp(9), dp(6), dp(2), dp(6))
                isClickable = true
                setOnClickListener { collapseExpanded() }
            },
        )
        card.addView(header)

        if (state == null || state.total <= 0) {
            card.addView(
                label("目前还没有待办哦", 12f, COLOR_MUTED).apply {
                    gravity = Gravity.CENTER
                    setPadding(0, dp(18), 0, dp(14))
                },
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
            return card
        }

        card.addView(
            buildGroupTabs(state),
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(10) },
        )

        val selected = state.groups.firstOrNull { it.key == selectedGroupKey && it.count > 0 }
            ?: state.groups.firstOrNull { it.count > 0 }
        if (selected == null) {
            return card
        }
        selectedGroupKey = selected.key
        card.addView(buildTaskList(selected))
        return card
    }

    private fun buildGroupTabs(state: TaskBarNotificationCore.OverlayState): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        state.groups.forEachIndexed { index, group ->
            val color = colorFor(group.key)
            val tab = label(
                "● ${group.label} ${group.count}",
                10.5f,
                color,
                true,
            ).apply {
                gravity = Gravity.CENTER
                setPadding(dp(6), dp(7), dp(6), dp(7))
                background = rounded(withAlpha(color, 0x20), 9f)
                alpha = if (group.count > 0) 1f else 0.35f
                isClickable = true
                setOnClickListener {
                    if (group.count > 0) {
                        selectedGroupKey = group.key
                        expanded = true
                        render()
                    }
                }
            }
            row.addView(
                tab,
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    if (index < state.groups.lastIndex) {
                        marginEnd = dp(5)
                    }
                },
            )
        }
        return row
    }

    private fun buildTaskList(group: TaskBarNotificationCore.Group): View {
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(5), 0, 0)
        }
        val visible = group.items.take(3)
        visible.forEachIndexed { index, item ->
            if (index > 0) {
                list.addView(divider())
            }
            list.addView(buildTaskRow(item, colorFor(group.key)))
        }
        if (group.count > visible.size) {
            list.addView(
                label("还有 ${group.count - visible.size} 项 · 打开时纪流", 10.5f, COLOR_MUTED, true)
                    .apply {
                        gravity = Gravity.CENTER
                        setPadding(0, dp(10), 0, dp(2))
                        isClickable = true
                        setOnClickListener { openApp() }
                    },
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        return list
    }

    private fun buildTaskRow(
        item: TaskBarNotificationCore.Item,
        color: Int,
    ): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(46)
            isClickable = true
            contentDescription = "打开 ${item.title}"
            setOnClickListener { openApp() }
        }
        row.addView(
            View(this).apply { background = rounded(color, 2f) },
            LinearLayout.LayoutParams(dp(3), dp(29)).apply {
                marginStart = dp(2)
                marginEnd = dp(10)
            },
        )
        val text = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        text.addView(label(item.title, 13f, COLOR_INK, true).apply { maxLines = 1 })
        text.addView(
            label(item.whenText, 10.5f, color).apply { maxLines = 1 },
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(2) },
        )
        row.addView(
            text,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        row.addView(
            label("○", 20f, color, true).apply {
                gravity = Gravity.CENTER
                setPadding(dp(8), dp(4), dp(4), dp(4))
                isClickable = true
                contentDescription = "完成 ${item.title}"
                setOnClickListener {
                    val action = TaskBarNotificationCore.completeItem(this@TaskBarOverlayService, item.key)
                    if (action != null) {
                        TaskBarNotificationModule.notifyCompletion(action)
                    }
                }
            },
        )
        return row
    }

    private fun divider(): View = View(this).apply {
        setBackgroundColor(0x14000000)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(1),
        ).apply { marginStart = dp(15) }
    }

    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            // 系统限制后台启动 Activity 时保留小条，用户仍可点图标进入 App。
        }
        expanded = false
        render()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "顶部任务小条",
            // 前台服务必须挂通知。保留低优先级可见，方便用户上滑直接关掉悬浮条。
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "保持顶部任务小条运行；上滑可关闭，不会发出提示音"
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
            enableLights(false)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        manager.createNotificationChannel(channel)
    }

    private fun startForegroundCompat() {
        val notification = buildServiceNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildServiceNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            73120,
            Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("chronoflow://tasks")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val dismiss = PendingIntent.getBroadcast(
            this,
            73121,
            Intent(this, TaskBarActionReceiver::class.java).setAction(ACTION_DISMISS),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_chronoflow)
            .setContentTitle("时纪流顶部任务小条")
            .setContentText("点开可查看待办；不需要时上滑关闭")
            .setContentIntent(open)
            // 允许上滑划掉；划掉后由 deleteIntent 关闭悬浮条，不再从后台自己弹回来。
            .setDeleteIntent(dismiss)
            .setOngoing(false)
            .setAutoCancel(false)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun statusBarHeightPx(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dp(24)
    }

    /** 状态栏真实 inset；资源里的 status_bar_height 在部分厂商 ROM 上会偏大。 */
    private fun statusBarInsetPx(): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val manager = getSystemService(WindowManager::class.java)
            val top = manager?.currentWindowMetrics?.windowInsets
                ?.getInsetsIgnoringVisibility(
                    WindowInsets.Type.statusBars() or WindowInsets.Type.displayCutout(),
                )
                ?.top
                ?: 0
            if (top > 0) {
                return top
            }
        }
        return statusBarHeightPx()
    }

    private fun collapsedBarWidth(): Int {
        val screenWidth = resources.displayMetrics.widthPixels
        val available = screenWidth - dp(128)
        val desired = (screenWidth * 0.40f).roundToInt()
        return desired.coerceAtMost(available).coerceIn(dp(132), dp(176))
    }

    private fun compactBarWidth(): Int {
        val screenWidth = resources.displayMetrics.widthPixels
        val desired = (screenWidth * 0.26f).roundToInt()
        return desired.coerceIn(dp(88), dp(112))
    }

    private fun expandedCardWidth(): Int {
        val screenWidth = resources.displayMetrics.widthPixels
        return (screenWidth - dp(24)).coerceAtMost(dp(420)).coerceAtLeast(dp(260))
    }

    private fun label(
        value: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
    ): TextView = TextView(this).apply {
        text = value
        setTextColor(color)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        includeFontPadding = false
        if (bold) {
            setTypeface(typeface, Typeface.BOLD)
        }
    }

    private fun colorFor(key: String): Int = when (key) {
        "urgent" -> COLOR_URGENT
        "soon" -> COLOR_SOON
        else -> COLOR_CALM
    }

    private fun withAlpha(color: Int, alpha: Int): Int =
        (color and 0x00FFFFFF) or (alpha shl 24)

    private fun rounded(color: Int, radiusDp: Float, strokeColor: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeColor != null) {
                setStroke(dp(1), strokeColor)
            }
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).roundToInt()

    private fun dp(value: Float): Int = dp(value.roundToInt())
}

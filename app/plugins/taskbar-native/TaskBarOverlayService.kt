package com.chronoflow.frontend

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.IntentFilter
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
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
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

        @Volatile
        private var active: TaskBarOverlayService? = null

        internal fun start(context: Context) {
            val intent = Intent(context, TaskBarOverlayService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        internal fun stop(context: Context) {
            context.stopService(Intent(context, TaskBarOverlayService::class.java))
        }

        internal fun isRunning(): Boolean = active != null

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

    private val screenStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            render()
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
            render()
        }

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    override fun onCreate() {
        super.onCreate()
        active = this
        ensureChannel()
        startForegroundCompat()
        (application as? Application)?.registerActivityLifecycleCallbacks(lifecycleCallbacks)
        ContextCompat.registerReceiver(
            this,
            screenStateReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        if (!Settings.canDrawOverlays(this)) {
            TaskBarNotificationCore.setOverlayWanted(this, false)
            stopSelf()
            return
        }
        showWindow()
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
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
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
        } catch (_: Exception) {
            rootView = null
            TaskBarNotificationCore.setOverlayWanted(this, false)
            stopSelf()
        }
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

    private fun scheduleRender() {
        Handler(Looper.getMainLooper()).postDelayed({
            if (active === this) {
                render()
            }
        }, 150)
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
            // 必须完全避开状态栏：状态栏窗口会优先吞掉触摸，压在状态栏里的部分点不动。
            y = statusBarHeightPx() + dp(2)
            title = "时纪流顶部任务条"
        }
    }

    private fun buildRoot(state: TaskBarNotificationCore.OverlayState?): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // 水平方向不留透明 padding：窗口有多宽，可点击区域就只有多宽。
            setPadding(0, 0, 0, 0)
        }
        root.addView(
            buildCollapsedBar(state),
            LinearLayout.LayoutParams(
                collapsedBarWidth(),
                dp(30),
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
        val toggle = {
            expanded = !expanded
            render()
        }
        val touch = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                collapsedBarWidth(),
                dp(30),
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
                    } else if (abs(dx) < dp(10) && abs(dy) < dp(10)) {
                        toggle()
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
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
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
                setOnClickListener {
                    expanded = false
                    render()
                }
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

    private fun collapsedBarWidth(): Int {
        val screenWidth = resources.displayMetrics.widthPixels
        val available = screenWidth - dp(128)
        val desired = (screenWidth * 0.40f).roundToInt()
        return desired.coerceAtMost(available).coerceIn(dp(132), dp(176))
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

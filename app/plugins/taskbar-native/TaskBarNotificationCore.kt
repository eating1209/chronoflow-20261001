package com.chronoflow.frontend

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews

import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

import org.json.JSONArray
import org.json.JSONObject

/**
 * 任务条通知的共享状态与绘制逻辑。
 *
 * <p>通知点击后的完成 / 切换分组由广播接收器处理，所以状态不能只放在 React Native 模块里：
 * 这里把当前 payload、选中分组、展开项和待同步完成动作都落到 SharedPreferences，
 * 这样 App 进程不在前台时，锁屏卡片也能立即更新。
 */
internal object TaskBarNotificationCore {

    const val ACTION = "com.chronoflow.frontend.TASKBAR_ACTION"
    const val ACTION_COMPLETE = "com.chronoflow.frontend.TASKBAR_COMPLETED"
    const val EXTRA_OP = "op"
    const val EXTRA_GROUP = "group"
    const val EXTRA_KEY = "key"
    const val OP_SELECT = "select"
    const val OP_EXPAND = "expand"
    const val OP_COMPLETE = "complete"
    const val OP_NOOP = "noop"

    // Android 创建渠道后不会更新旧的锁屏重要级；换新 id 让 OPPO 等系统重新识别。
    const val CHANNEL_ID = "taskbar-overview-v2"
    const val NOTIFICATION_ID = 7311

    private const val PREFS = "chronoflow_taskbar_state"
    private const val KEY_PAYLOAD = "payload"
    private const val KEY_SELECTED = "selected_group"
    private const val KEY_EXPANDED = "expanded_key"
    private const val KEY_SHOW_ITEMS = "show_items"
    private const val KEY_COMPLETED = "completed_keys"
    private const val KEY_PENDING = "pending_completions"
    private const val KEY_UPDATED_AT = "updated_at"
    private const val KEY_LAST_ERROR = "last_error"
    private const val KEY_OVERLAY_ENABLED = "overlay_enabled"

    private const val COLOR_INK = 0xFF25262A.toInt()
    private const val COLOR_MUTED = 0xFF6B6B6B.toInt()
    private const val COLOR_TRACK = 0xFFE5E5E5.toInt()
    private const val COLOR_URGENT = 0xFFB3352F.toInt()
    private const val COLOR_SOON = 0xFFB58500.toInt()
    private const val COLOR_CALM = 0xFF2E7D5B.toInt()

    private val GROUP_KEYS = arrayOf("urgent", "soon", "calm")
    private val GROUP_LABELS = arrayOf("紧急", "临近", "从容")
    private val GROUP_COLORS = intArrayOf(COLOR_URGENT, COLOR_SOON, COLOR_CALM)

    internal data class Item(
        val key: String,
        val kind: String,
        val id: Int,
        val occurrenceDate: String?,
        val title: String,
        val whenText: String,
        val at: String?,
        val today: Boolean,
        val overdue: Boolean,
        val location: String,
        val note: String,
        val hasDetails: Boolean,
    )

    internal data class Group(
        val key: String,
        val label: String,
        val count: Int,
        val items: List<Item>,
    )

    internal data class Payload(
        val total: Int,
        val todayCount: Int,
        val overdueCount: Int,
        val headline: String,
        val nearestTitle: String,
        val nearestWhen: String,
        val groups: List<Group>,
    )

    internal data class CompletedAction(
        val key: String,
        val kind: String,
        val id: Int,
        val occurrenceDate: String?,
        val completedAt: String,
    )

    private data class VisibleState(
        val groups: List<Group>,
        val total: Int,
        val todayCount: Int,
        val overdueCount: Int,
        val headline: String,
    )

    /**
     * 顶部悬浮小条只读取这份快照，不重新解释 payload。
     *
     * <p>通知和悬浮条必须共用「已完成项过滤 / 选中分组」这套逻辑，否则用户在任意一处
     * 勾掉任务后，另一处还会短暂显示旧内容。
     */
    internal data class OverlayState(
        val groups: List<Group>,
        val total: Int,
        val todayCount: Int,
        val overdueCount: Int,
        val headline: String,
        val selectedGroupKey: String?,
    )

    fun storePayload(context: Context, payloadJson: String): Boolean {
        return try {
            val payload = parsePayload(payloadJson)
            val prefs = prefs(context)
            val knownKeys = payload.groups.flatMap { group -> group.items.map { it.key } }.toSet()
            val completed = readStringSet(prefs, KEY_COMPLETED).filter { it in knownKeys }.toSet()
            val selected = prefs.getString(KEY_SELECTED, null)?.takeIf { key ->
                payload.groups.any { it.key == key }
            } ?: firstNonEmptyGroup(payload)
            val expanded = prefs.getString(KEY_EXPANDED, null)?.takeIf { key ->
                payload.groups.any { group ->
                    group.items.any { item -> item.key == key && item.hasDetails }
                }
            }

            prefs.edit()
                .putString(KEY_PAYLOAD, payloadJson)
                .putString(KEY_SELECTED, selected)
                .putString(KEY_EXPANDED, expanded)
                // 与 markCompleted/readStringSet 保持一致：统一存 JSON 字符串。
                // 旧版本这里误写成 StringSet，升级后仍要能被下面的兼容读取识别。
                .putString(KEY_COMPLETED, JSONArray(completed.toList()).toString())
                .putLong(KEY_UPDATED_AT, System.currentTimeMillis())
                .apply()

            render(context)
        } catch (error: Exception) {
            recordError(context, error)
            false
        }
    }

    fun clear(context: Context) {
        try {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        } catch (_: Exception) {
            // 清通知失败不能影响 App 退出登录等主流程。
        }
        prefs(context).edit()
            .remove(KEY_PAYLOAD)
            .remove(KEY_SELECTED)
            .remove(KEY_EXPANDED)
            .remove(KEY_SHOW_ITEMS)
            .remove(KEY_COMPLETED)
            .remove(KEY_UPDATED_AT)
            .apply()
        TaskBarOverlayService.refresh(context)
    }

    fun isOverlayWanted(context: Context): Boolean =
        prefs(context).getBoolean(KEY_OVERLAY_ENABLED, false)

    fun setOverlayWanted(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_OVERLAY_ENABLED, enabled).apply()
    }

    internal fun overlayState(context: Context): OverlayState? {
        val payload = readPayload(context) ?: return null
        val prefs = prefs(context)
        val visible = visibleState(payload, prefs)
        val selected = prefs.getString(KEY_SELECTED, null)?.takeIf { key ->
            visible.groups.any { it.key == key && it.count > 0 }
        } ?: visible.groups.firstOrNull { it.count > 0 }?.key
        return OverlayState(
            groups = visible.groups,
            total = visible.total,
            todayCount = visible.todayCount,
            overdueCount = visible.overdueCount,
            headline = visible.headline,
            selectedGroupKey = selected,
        )
    }

    fun isPermissionGranted(context: Context): Boolean {
        val runtimeGranted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        return runtimeGranted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun handleAction(context: Context, intent: Intent): CompletedAction? {
        val op = intent.getStringExtra(EXTRA_OP) ?: return null
        val prefs = prefs(context)
        when (op) {
            OP_SELECT -> {
                val group = intent.getStringExtra(EXTRA_GROUP)?.takeIf { it in GROUP_KEYS }
                    ?: return null
                val wasOpen = prefs.getBoolean(KEY_SHOW_ITEMS, false) &&
                    prefs.getString(KEY_SELECTED, null) == group
                prefs.edit()
                    .putString(KEY_SELECTED, group)
                    .putBoolean(KEY_SHOW_ITEMS, !wasOpen)
                    .remove(KEY_EXPANDED)
                    .apply()
                render(context)
                return null
            }

            OP_EXPAND -> {
                val key = intent.getStringExtra(EXTRA_KEY) ?: return null
                val current = prefs.getString(KEY_EXPANDED, null)
                prefs.edit()
                    .putString(KEY_EXPANDED, if (current == key) null else key)
                    .putBoolean(KEY_SHOW_ITEMS, true)
                    .apply()
                render(context)
                return null
            }

            OP_COMPLETE -> {
                val key = intent.getStringExtra(EXTRA_KEY) ?: return null
                return completeItem(context, key)
            }

            OP_NOOP -> return null
        }
        return null
    }

    fun pendingJson(context: Context): String {
        return try {
            readPendingArray(prefs(context)).toString()
        } catch (_: Exception) {
            "[]"
        }
    }

    fun acknowledge(context: Context, keysJson: String) {
        val keys = try {
            val requested = JSONArray(keysJson)
            (0 until requested.length()).mapNotNull { index ->
                requested.optString(index, "").takeIf { it.isNotBlank() }
            }.toSet()
        } catch (_: Exception) {
            emptySet()
        }
        if (keys.isEmpty()) {
            return
        }
        val pending = readPendingArray(prefs(context))
        val kept = JSONArray()
        for (index in 0 until pending.length()) {
            val item = pending.optJSONObject(index) ?: continue
            if (item.optString("key", "") !in keys) {
                kept.put(item)
            }
        }
        prefs(context).edit().putString(KEY_PENDING, kept.toString()).apply()
    }

    fun render(context: Context): Boolean {
        val rendered = try {
            renderInternal(context)
        } catch (error: Exception) {
            recordError(context, error)
            false
        }
        TaskBarOverlayService.refresh(context)
        return rendered
    }

    internal fun completeItem(context: Context, key: String): CompletedAction? {
        val prefs = prefs(context)
        val payload = readPayload(context) ?: return null
        val item = payload.groups.asSequence()
            .flatMap { it.items.asSequence() }
            .firstOrNull { it.key == key }
            ?: return null
        if (!markCompleted(prefs, key)) {
            return null
        }
        val action = CompletedAction(
            key = key,
            kind = item.kind,
            id = item.id,
            occurrenceDate = item.occurrenceDate,
            completedAt = java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                java.util.Locale.US,
            ).format(java.util.Date()),
        )
        appendPending(prefs, action)
        render(context)
        return action
    }

    private fun renderInternal(context: Context): Boolean {
        val payload = readPayload(context) ?: return false
        val prefs = prefs(context)
        val visible = visibleState(payload, prefs)
        val groups = visible.groups
        val total = visible.total
        val todayCount = visible.todayCount
        val overdueCount = visible.overdueCount

        if (total <= 0) {
            try {
                NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
            } catch (_: Exception) {
                // ignore
            }
            return false
        }

        var selected = prefs.getString(KEY_SELECTED, null)
        if (selected == null || groups.none { it.key == selected && it.count > 0 }) {
            selected = groups.firstOrNull { it.count > 0 }?.key ?: "urgent"
            prefs.edit().putString(KEY_SELECTED, selected).apply()
        }
        val selectedGroup = groups.firstOrNull { it.key == selected }
            ?: groups.firstOrNull { it.count > 0 }
            ?: groups.firstOrNull()
            ?: return false

        val expandedKey = prefs.getString(KEY_EXPANDED, null)?.takeIf { key ->
            selectedGroup.items.any { it.key == key && it.hasDetails }
        }
        val showItems = prefs.getBoolean(KEY_SHOW_ITEMS, false)

        val headline = visible.headline

        val contextSafe = context
        // 两种内容都控制在通知的收起高度内：未点色段时是总览，点色段后
        // 直接替换成任务列表，再点同一色段换回总览，不依赖用户下拉展开。
        val summaryView = RemoteViews(
            contextSafe.packageName,
            R.layout.taskbar_notification_collapsed,
        )
        fillSummary(
            summaryView,
            contextSafe,
            headline,
            payload,
            groups,
            if (showItems) selectedGroup else null,
        )

        val taskView = RemoteViews(
            contextSafe.packageName,
            R.layout.taskbar_notification_expanded,
        )
        fillSegments(taskView, contextSafe, groups)
        fillSelectedTasks(taskView, contextSafe, selectedGroup, expandedKey)
        val bigContentView = if (showItems) taskView else summaryView

        // 整张通知卡都能切换「总览 / 当前分组」。厂商通知栏和锁屏会把
        // 色段之外的空白区域当成不可点，用户点了没反应；这里给根布局补上动作。
        summaryView.setOnClickPendingIntent(
            R.id.taskbar_notification_root,
            actionPending(contextSafe, OP_SELECT, selectedGroup.key, null),
        )

        // 只有左上角的小图标可点：带深链直接落到「待办」页，其余区域不打开 App。
        val openIntent = Intent(contextSafe, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("chronoflow://tasks")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = PendingIntent.getActivity(
            contextSafe,
            9000,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        summaryView.setOnClickPendingIntent(R.id.taskbar_bar, openPending)
        taskView.setOnClickPendingIntent(R.id.taskbar_bar, openPending)
        try {
            ensureChannel(contextSafe)
            // 国产 ROM 的锁屏经常不渲染第三方 RemoteViews。锁屏用系统原生通知，
            // 通知栏仍保留下面的三色自定义卡；彩色圆点用 emoji 保留三色语义。
            val lockScreenCard = buildLockScreenCard(
                contextSafe,
                headline,
                payload,
                groups,
            )
            val notification = NotificationCompat.Builder(contextSafe, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_chronoflow)
                .setContentTitle("时纪流")
                .setContentText(headline)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setColor(COLOR_INK)
                // 锁屏显示系统原生版本，解锁后的通知栏显示三色自定义版本。
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(lockScreenCard)
                // STATUS 常被国产 ROM 归为「后台状态」，锁屏直接隐藏；提醒类别更容易展示。
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                // 不使用 DecoratedCustomViewStyle：它会在国产 ROM 锁屏上再套一层
                // 系统卡片，把本来就不高的自定义内容裁成一条。这里直接交自己的
                // 低高度布局，收起态和锁屏都能完整显示三色条与首条任务。
                .setCustomContentView(summaryView)
                .setCustomBigContentView(bigContentView)
                .build()
            NotificationManagerCompat.from(contextSafe).notify(NOTIFICATION_ID, notification)
            prefs.edit().remove(KEY_LAST_ERROR).apply()
            return true
        } catch (error: Exception) {
            recordError(contextSafe, error)
            return false
        }
    }

    private fun buildLockScreenCard(
        context: Context,
        headline: String,
        payload: Payload,
        groups: List<Group>,
    ): Notification {
        val groupLine = groups.joinToString("  ") { group ->
            val dot = when (group.key) {
                "urgent" -> "🔴"
                "soon" -> "🟠"
                else -> "🟢"
            }
            "$dot ${group.label} ${group.count}"
        }
        val nearest = if (payload.nearestTitle.isBlank()) {
            "最近 ${payload.nearestWhen}"
        } else {
            "最近 ${payload.nearestWhen} · ${payload.nearestTitle}"
        }
        val body = listOf(groupLine, nearest)
            .filter { it.isNotBlank() }
            .joinToString("\n")
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_chronoflow)
            .setContentTitle("时纪流 · $headline")
            .setContentText(groupLine)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setColor(COLOR_INK)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
    }

    private fun fillSummary(
        views: RemoteViews,
        context: Context,
        headline: String,
        payload: Payload,
        groups: List<Group>,
        selectedGroup: Group?,
    ) {
        views.setTextViewText(
            R.id.taskbar_headline,
            if (selectedGroup != null) {
                "${selectedGroup.label}任务 · ${selectedGroup.count} 项"
            } else {
                headline
            },
        )
        val selectedItem = selectedGroup?.items?.firstOrNull()
        if (selectedItem != null) {
            // 收起态不做「先换一张更大的图」：系统不会因为换了
            // bigContentView 就替用户展开通知。直接在当前一行里显示首条任务，
            // 点色段立即看得到，点同一色段又回到总览。
            views.setViewVisibility(R.id.taskbar_nearest, View.GONE)
            views.setViewVisibility(R.id.taskbar_compact_legend, View.GONE)
            views.setViewVisibility(R.id.taskbar_compact_task, View.VISIBLE)
            views.setTextViewText(R.id.taskbar_compact_title, selectedItem.title)
            views.setTextViewText(R.id.taskbar_compact_when, selectedItem.whenText)
            views.setTextViewText(R.id.taskbar_compact_circle, "○")
            views.setTextColor(R.id.taskbar_compact_circle, colorFor(selectedGroup.key))
            views.setOnClickPendingIntent(
                R.id.taskbar_compact_circle,
                actionPending(context, OP_COMPLETE, null, selectedItem.key),
            )
        } else {
            views.setViewVisibility(R.id.taskbar_nearest, View.VISIBLE)
            views.setViewVisibility(R.id.taskbar_compact_legend, View.VISIBLE)
            views.setViewVisibility(R.id.taskbar_compact_task, View.GONE)
            views.setTextViewText(
                R.id.taskbar_nearest,
                if (payload.nearestTitle.isBlank()) {
                    "最近 ${payload.nearestWhen}"
                } else {
                    "最近 ${payload.nearestWhen} · ${payload.nearestTitle}"
                },
            )
        }
        fillSegments(views, context, groups)
        if (selectedItem == null) {
            fillLegends(views, context, groups)
        }
    }

    private fun fillSegments(views: RemoteViews, context: Context, groups: List<Group>) {
        val segmentIds = intArrayOf(
            R.id.taskbar_group_row_urgent,
            R.id.taskbar_group_row_soon,
            R.id.taskbar_group_row_calm,
        )
        groups.take(3).forEachIndexed { index, group ->
            val segmentId = segmentIds[index]
            if (group.count <= 0) {
                views.setViewVisibility(segmentId, View.GONE)
            } else {
                views.setViewVisibility(segmentId, View.VISIBLE)
                views.setImageViewBitmap(segmentId, segmentBitmap(GROUP_COLORS[index]))
                views.setOnClickPendingIntent(
                    segmentId,
                    actionPending(context, OP_SELECT, group.key, null),
                )
            }
        }
    }

    private fun visibleState(
        payload: Payload,
        prefs: android.content.SharedPreferences,
    ): VisibleState {
        val completed = readStringSet(prefs, KEY_COMPLETED)
        val groups = payload.groups.map { group ->
            val items = group.items.filterNot { it.key in completed }
            val removed = group.items.count { it.key in completed }
            Group(
                key = group.key,
                label = group.label,
                count = (group.count - removed).coerceAtLeast(0),
                items = items,
            )
        }
        val completedItems = payload.groups
            .asSequence()
            .flatMap { it.items.asSequence() }
            .filter { it.key in completed }
            .toList()
        val removedTotal = completedItems.size
        val total = (payload.total - removedTotal).coerceAtLeast(0)
        val todayCount = (payload.todayCount - completedItems.count { it.today })
            .coerceAtLeast(0)
        val overdueCount = (payload.overdueCount - completedItems.count { it.overdue })
            .coerceAtLeast(0)
        val headline = when {
            todayCount > 0 -> "$todayCount 项任务今天截止"
            overdueCount > 0 -> "$overdueCount 项任务已逾期"
            else -> "$total 项待办与日程"
        }
        return VisibleState(
            groups = groups,
            total = total,
            todayCount = todayCount,
            overdueCount = overdueCount,
            headline = headline,
        )
    }

    private fun fillLegends(views: RemoteViews, context: Context, groups: List<Group>) {
        val legendIds = intArrayOf(
            R.id.taskbar_legend_urgent,
            R.id.taskbar_legend_soon,
            R.id.taskbar_legend_calm,
        )
        groups.take(3).forEachIndexed { index, group ->
            val legendId = legendIds[index]
            if (group.count <= 0) {
                views.setViewVisibility(legendId, View.INVISIBLE)
            } else {
                views.setViewVisibility(legendId, View.VISIBLE)
                views.setTextViewText(legendId, "● ${GROUP_LABELS[index]} ${group.count}")
                views.setTextColor(legendId, GROUP_COLORS[index])
                views.setOnClickPendingIntent(
                    legendId,
                    actionPending(context, OP_SELECT, group.key, null),
                )
            }
        }
    }

    private fun fillSelectedTasks(
        views: RemoteViews,
        context: Context,
        group: Group,
        expandedKey: String?,
    ) {
        val color = colorFor(group.key)
        views.setTextViewText(R.id.taskbar_headline, "${group.label}任务 · ${group.count} 项")
        val firstWhen = group.items.firstOrNull()?.whenText
        if (firstWhen.isNullOrBlank()) {
            views.setViewVisibility(R.id.taskbar_nearest, View.GONE)
        } else {
            views.setViewVisibility(R.id.taskbar_nearest, View.VISIBLE)
            views.setTextViewText(R.id.taskbar_nearest, "最早 $firstWhen")
        }
        val circleIds = intArrayOf(
            R.id.taskbar_group_label_urgent,
            R.id.taskbar_group_label_soon,
            R.id.taskbar_group_label_calm,
        )
        val titleIds = intArrayOf(
            R.id.taskbar_group_title_urgent,
            R.id.taskbar_group_title_soon,
            R.id.taskbar_group_title_calm,
        )
        val whenIds = intArrayOf(
            R.id.taskbar_group_when_urgent,
            R.id.taskbar_group_when_soon,
            R.id.taskbar_group_when_calm,
        )

        val expandedItem = group.items.firstOrNull {
            it.key == expandedKey && it.hasDetails
        }
        if (expandedItem != null) {
            views.setViewVisibility(R.id.taskbar_nearest_title, View.VISIBLE)
            views.setTextViewText(R.id.taskbar_nearest_title, detailText(expandedItem))
            views.setTextColor(R.id.taskbar_nearest_title, color)
        } else {
            views.setViewVisibility(R.id.taskbar_nearest_title, View.GONE)
        }

        for (index in 0 until 3) {
            val item = group.items.getOrNull(index)
            if (item == null) {
                views.setViewVisibility(circleIds[index], View.GONE)
                views.setViewVisibility(titleIds[index], View.GONE)
                views.setViewVisibility(whenIds[index], View.GONE)
                continue
            }
            views.setViewVisibility(circleIds[index], View.VISIBLE)
            views.setViewVisibility(titleIds[index], View.VISIBLE)
            views.setViewVisibility(whenIds[index], View.VISIBLE)
            // 完成控件固定在行尾，任务和日程都用同一个圆形勾选入口。
            views.setTextViewText(circleIds[index], "○")
            views.setTextColor(circleIds[index], color)
            views.setTextViewText(titleIds[index], item.title)
            views.setTextViewText(
                whenIds[index],
                if (!item.hasDetails) {
                    item.whenText
                } else if (expandedKey == item.key) {
                    "${item.whenText} ⌄"
                } else {
                    "${item.whenText} ›"
                },
            )
            views.setTextColor(whenIds[index], color)
            views.setOnClickPendingIntent(
                circleIds[index],
                actionPending(context, OP_COMPLETE, null, item.key),
            )
            if (item.hasDetails) {
                views.setOnClickPendingIntent(
                    whenIds[index],
                    actionPending(context, OP_EXPAND, null, item.key),
                )
            }
        }
    }

    private fun detailText(item: Item): String {
        val lines = mutableListOf<String>()
        if (item.whenText.isNotBlank()) {
            lines += "时间  ${item.whenText}"
        }
        if (item.location.isNotBlank()) {
            lines += "地点  ${item.location}"
        }
        if (item.note.isNotBlank()) {
            lines += "备注  ${item.note}"
        }
        return lines.joinToString(" · ")
    }

    private fun setsafeText(views: RemoteViews, viewId: Int, text: String) {
        views.setTextViewText(viewId, text)
    }

    private fun whenLabel(key: String): String = when (key) {
        "urgent" -> "48 小时内"
        "soon" -> "7 天内"
        else -> "7 天后"
    }

    private fun colorFor(key: String): Int = when (key) {
        "urgent" -> COLOR_URGENT
        "soon" -> COLOR_SOON
        else -> COLOR_CALM
    }

    private fun firstNonEmptyGroup(payload: Payload): String {
        return payload.groups.firstOrNull { it.count > 0 }?.key ?: "urgent"
    }

    private fun parseTime(at: String?): Long? {
        if (at.isNullOrBlank()) {
            return null
        }
        val patterns = arrayOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
        )
        for (pattern in patterns) {
            try {
                return java.text.SimpleDateFormat(pattern, java.util.Locale.US)
                    .parse(at)
                    ?.time
            } catch (_: Exception) {
                // 换下一种格式继续尝试。
            }
        }
        return null
    }

    private fun segmentBitmap(color: Int): Bitmap {
        val width = 320
        // 整张 View 高 24dp 都可以点；只在位图中间画 10dp 左右的色条，
        // 视觉保持细线，但锁屏上不用再瞄准那一小条。
        val height = 240
        val barTop = 70f
        val barBottom = 170f
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = color
        canvas.drawRoundRect(
            RectF(0f, barTop, width.toFloat(), barBottom),
            20f,
            20f,
            paint,
        )
        return bitmap
    }

    private fun actionPending(
        context: Context,
        op: String,
        group: String?,
        key: String?,
    ): PendingIntent {
        val uri = buildString {
            append("chronoflow://taskbar/")
            append(op)
            append('/')
            append(Uri.encode(group ?: "-"))
            append('/')
            append(Uri.encode(key ?: "-"))
        }
        val intent = Intent(context, TaskBarActionReceiver::class.java).apply {
            action = ACTION
            data = Uri.parse(uri)
            putExtra(EXTRA_OP, op)
            group?.let { putExtra(EXTRA_GROUP, it) }
            key?.let { putExtra(EXTRA_KEY, it) }
        }
        val requestCode = 31 * op.hashCode() + 17 * (group?.hashCode() ?: 0) + (key?.hashCode() ?: 0)
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun lastError(context: Context): String? =
        prefs(context).getString(KEY_LAST_ERROR, null)

    private fun recordError(context: Context, error: Exception) {
        val message = "${error.javaClass.simpleName}: ${error.message ?: "unknown"}"
        prefs(context).edit().putString(KEY_LAST_ERROR, message).apply()
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "任务栏与锁屏任务总览",
            // OPPO ColorOS 对低重要级的常驻通知可能只留在通知栏、不放到锁屏。
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "在通知栏和锁屏持续显示未完成的待办与日程，内容跟随 App 数据更新"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setSound(null, null)
            enableVibration(false)
            enableLights(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun readPayload(context: Context): Payload? {
        val raw = prefs(context).getString(KEY_PAYLOAD, null) ?: return null
        return try {
            parsePayload(raw)
        } catch (_: Exception) {
            null
        }
    }

    private fun parsePayload(payloadJson: String): Payload {
        val root = JSONObject(payloadJson)
        val groupsJson = root.optJSONArray("groups")
        val groups = buildList {
            if (groupsJson != null) {
                for (index in 0 until groupsJson.length()) {
                    val groupJson = groupsJson.optJSONObject(index) ?: continue
                    val itemsJson = groupJson.optJSONArray("items")
                    val items = buildList {
                        if (itemsJson != null) {
                            for (itemIndex in 0 until itemsJson.length()) {
                                val item = itemsJson.optJSONObject(itemIndex) ?: continue
                                add(
                                    Item(
                                        key = item.optString("key", ""),
                                        kind = item.optString("kind", "task"),
                                        id = item.optInt("id", 0),
                                        occurrenceDate = item.optString("occurrenceDate", "")
                                            .takeIf { it.isNotBlank() },
                                        title = item.optString("title", ""),
                                        whenText = item.optString("whenText", "待安排"),
                                        at = item.optString("at", "").takeIf { it.isNotBlank() },
                                        today = item.optBoolean("today", false),
                                        overdue = item.optBoolean("overdue", false),
                                        location = item.optString("location", ""),
                                        note = item.optString("note", ""),
                                        hasDetails = item.optBoolean("hasDetails", false),
                                    ),
                                )
                            }
                        }
                    }
                    add(
                        Group(
                            key = groupJson.optString("key", ""),
                            label = groupJson.optString("label", ""),
                            count = groupJson.optInt("count", 0),
                            items = items,
                        ),
                    )
                }
            }
        }
        return Payload(
            total = root.optInt("total", 0),
            todayCount = root.optInt("todayCount", 0),
            overdueCount = root.optInt("overdueCount", 0),
            headline = root.optString("headline", "任务总览"),
            nearestTitle = root.optString("nearestTitle", "暂无待安排事项"),
            nearestWhen = root.optString("nearestWhen", "—"),
            groups = groups,
        )
    }

    private fun readStringSet(
        prefs: android.content.SharedPreferences,
        key: String,
    ): Set<String> {
        // 不直接 getString：旧版本可能把同一 key 写成 StringSet，厂商机上会抛
        // ClassCastException 并导致整张三色卡退回普通通知。两种格式都兼容。
        val value = prefs.all[key] ?: return emptySet()
        if (value is Set<*>) {
            return value.filterIsInstance<String>().toSet()
        }
        if (value !is String) {
            return emptySet()
        }
        return try {
            val array = JSONArray(value)
            (0 until array.length()).mapNotNull { index ->
                array.optString(index, "").takeIf { it.isNotBlank() }
            }.toSet()
        } catch (_: Exception) {
            emptySet()
        }
    }

    private fun markCompleted(
        prefs: android.content.SharedPreferences,
        key: String,
    ): Boolean {
        val completed = readStringSet(prefs, KEY_COMPLETED).toMutableSet()
        if (!completed.add(key)) {
            return false
        }
        prefs.edit().putString(KEY_COMPLETED, JSONArray(completed.toList()).toString()).apply()
        return true
    }

    private fun readPendingArray(prefs: android.content.SharedPreferences): JSONArray {
        val raw = prefs.getString(KEY_PENDING, null) ?: return JSONArray()
        return try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
    }

    private fun appendPending(
        prefs: android.content.SharedPreferences,
        action: CompletedAction,
    ) {
        val pending = readPendingArray(prefs)
        for (index in 0 until pending.length()) {
            if (pending.optJSONObject(index)?.optString("key") == action.key) {
                return
            }
        }
        pending.put(
            JSONObject()
                .put("key", action.key)
                .put("kind", action.kind)
                .put("id", action.id)
                .put("occurrenceDate", action.occurrenceDate)
                .put("completedAt", action.completedAt),
        )
        prefs.edit().putString(KEY_PENDING, pending.toString()).apply()
    }
}

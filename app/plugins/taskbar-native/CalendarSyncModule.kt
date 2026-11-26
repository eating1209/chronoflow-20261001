package com.chronoflow.frontend

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 单向导出：把时纪流的日程写进手机自带的日历。
 *
 * <p>只写入我们自己创建的事件：事件 id 与系统日历 id 的对应关系存在本机，
 * 修改/删除都按这个映射走，不会碰用户在系统日历里自己记的东西。
 * 写入目标是系统里的主日历（没有主日历时选第一个可写日历）。
 */
class CalendarSyncModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "ChronoflowCalendar"
        private const val PREFS = "chronoflow_calendar_sync"
        private const val KEY_CALENDAR_ID = "calendar_id"
        private const val KEY_EVENT_PREFIX = "event_"

        private val worker = Executors.newSingleThreadExecutor()

        private fun prefs(context: Context) =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        private fun mappingKey(eventId: Long) = "$KEY_EVENT_PREFIX$eventId"
    }

    override fun getName(): String = NAME

    /** 写入或更新一条日程；返回系统日历里的事件 id。 */
    @ReactMethod
    fun upsertEvent(payloadJson: String, promise: Promise) {
        worker.execute {
            try {
                val payload = JSONObject(payloadJson)
                val eventId = payload.getLong("eventId")
                val calendarId = resolveCalendarId()
                if (calendarId <= 0) {
                    promise.reject("E_CALENDAR_NONE", "手机里没有可写入的日历")
                    return@execute
                }
                val values = buildValues(payload, calendarId)
                val existing = prefs(reactContext).getLong(mappingKey(eventId), -1L)
                var systemId = -1L
                if (existing > 0) {
                    val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existing)
                    val updated = reactContext.contentResolver.update(uri, values, null, null)
                    if (updated > 0) {
                        systemId = existing
                    }
                }
                if (systemId <= 0) {
                    val uri = reactContext.contentResolver.insert(
                        CalendarContract.Events.CONTENT_URI,
                        values,
                    )
                    systemId = uri?.lastPathSegment?.toLongOrNull() ?: -1L
                }
                if (systemId <= 0) {
                    promise.reject("E_CALENDAR_WRITE", "系统日历没有接受这条日程")
                    return@execute
                }
                prefs(reactContext).edit()
                    .putLong(KEY_CALENDAR_ID, calendarId)
                    .putLong(mappingKey(eventId), systemId)
                    .apply()
                promise.resolve(systemId.toDouble())
            } catch (error: Exception) {
                promise.reject("E_CALENDAR_WRITE", error.message ?: "写入系统日历失败", error)
            }
        }
    }

    /** 删除一条我们导出过的日程；系统里已不存在时也当作成功。 */
    @ReactMethod
    fun deleteEvent(eventId: Double, promise: Promise) {
        worker.execute {
            try {
                val id = eventId.toLong()
                val systemId = prefs(reactContext).getLong(mappingKey(id), -1L)
                if (systemId > 0) {
                    val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, systemId)
                    reactContext.contentResolver.delete(uri, null, null)
                }
                prefs(reactContext).edit().remove(mappingKey(id)).apply()
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("E_CALENDAR_DELETE", error.message ?: "删除系统日历日程失败", error)
            }
        }
    }

    /** 关闭同步时清掉所有由时纪流写入的事件。 */
    @ReactMethod
    fun clearAll(promise: Promise) {
        worker.execute {
            try {
                val all = prefs(reactContext).all
                for ((key, value) in all) {
                    if (!key.startsWith(KEY_EVENT_PREFIX)) {
                        continue
                    }
                    val systemId = (value as? Long) ?: continue
                    if (systemId > 0) {
                        val uri = ContentUris.withAppendedId(
                            CalendarContract.Events.CONTENT_URI,
                            systemId,
                        )
                        reactContext.contentResolver.delete(uri, null, null)
                    }
                }
                prefs(reactContext).edit().clear().apply()
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("E_CALENDAR_CLEAR", error.message ?: "清理系统日历失败", error)
            }
        }
    }

    /** 诊断用：当前能不能写系统日历。 */
    @ReactMethod
    fun diagnostics(promise: Promise) {
        try {
            val read = reactContext.checkSelfPermission(android.Manifest.permission.READ_CALENDAR)
            val write = reactContext.checkSelfPermission(android.Manifest.permission.WRITE_CALENDAR)
            val calendarId = resolveCalendarId()
            val result = JSONObject().apply {
                put("readGranted", read == android.content.pm.PackageManager.PERMISSION_GRANTED)
                put("writeGranted", write == android.content.pm.PackageManager.PERMISSION_GRANTED)
                put("calendarId", calendarId)
            }
            promise.resolve(result.toString())
        } catch (error: Exception) {
            promise.reject("E_CALENDAR_DIAG", error.message ?: "读取日历状态失败", error)
        }
    }

    private fun resolveCalendarId(): Long {
        val cached = prefs(reactContext).getLong(KEY_CALENDAR_ID, -1L)
        if (cached > 0 && calendarExists(cached)) {
            return cached
        }
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.VISIBLE,
        )
        var fallback = -1L
        var visibleFallback = -1L
        var primary = -1L
        // 不按 VISIBLE 过滤：有的机型把「主日历」标成不可见但依然可写，
        // 过滤掉会误报「手机里没有可写入的日历」。优先主日历，其次可见的，最后任意可写的。
        reactContext.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            null,
            null,
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getLong(0)
                val access = cursor.getInt(1)
                val isPrimary = cursor.getInt(2) == 1
                val visible = cursor.getInt(3) == 1
                if (access < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                    continue
                }
                if (fallback <= 0) {
                    fallback = id
                }
                if (visible && visibleFallback <= 0) {
                    visibleFallback = id
                }
                if (isPrimary) {
                    primary = id
                    break
                }
            }
        }
        return when {
            primary > 0 -> primary
            visibleFallback > 0 -> visibleFallback
            else -> fallback
        }
    }

    private fun calendarExists(calendarId: Long): Boolean {
        val uri = ContentUris.withAppendedId(
            CalendarContract.Calendars.CONTENT_URI,
            calendarId,
        )
        return reactContext.contentResolver.query(uri, arrayOf(CalendarContract.Calendars._ID), null, null, null)
            ?.use { it.moveToFirst() } ?: false
    }

    private fun buildValues(payload: JSONObject, calendarId: Long): ContentValues {
        val start = payload.getLong("startMillis")
        val end = payload.getLong("endMillis")
        val allDay = payload.optBoolean("allDay", false)
        val rrule = payload.optString("rrule", "").takeIf { it.isNotBlank() }
        val durationSeconds = ((end - start) / 1000L).coerceAtLeast(60L)
        val location = listOf(
            payload.optString("locationName", ""),
            payload.optString("locationDetail", ""),
            payload.optString("locationAddress", ""),
        ).filter { it.isNotBlank() }.distinct().joinToString(" · ")
        val note = payload.optString("description", "")
        val description = if (note.isBlank()) "来自时纪流" else "$note\n\n来自时纪流"

        return ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, payload.getString("title"))
            put(CalendarContract.Events.DESCRIPTION, description)
            // 编辑时地点可能被清空：显式写 null，避免旧地点留在系统日历里。
            if (location.isNotBlank()) {
                put(CalendarContract.Events.EVENT_LOCATION, location)
            } else {
                putNull(CalendarContract.Events.EVENT_LOCATION)
            }
            // 全天事件必须按 UTC 零点落库；否则华为 / OPPO 日历可能整体偏一天。
            val timezone = if (allDay) "UTC" else payload.optString("timezone", "Asia/Shanghai")
            put(CalendarContract.Events.DTSTART, start)
            put(CalendarContract.Events.EVENT_TIMEZONE, timezone)
            put(CalendarContract.Events.EVENT_END_TIMEZONE, timezone)
            put(CalendarContract.Events.ALL_DAY, if (allDay) 1 else 0)
            put(CalendarContract.Events.HAS_ALARM, 0)
            put(CalendarContract.Events.STATUS, CalendarContract.Events.STATUS_CONFIRMED)
            if (rrule != null) {
                // 重复日程用 DURATION 表示每次多久，系统日历不接受 DTEND + RRULE 的组合。
                put(CalendarContract.Events.RRULE, rrule)
                if (allDay) {
                    val durationDays = ((end - start) / 86_400_000L).coerceAtLeast(1L)
                    put(CalendarContract.Events.DURATION, "P${durationDays}D")
                } else {
                    put(CalendarContract.Events.DURATION, "P${durationSeconds}S")
                }
                putNull(CalendarContract.Events.DTEND)
            } else {
                // 从「重复」改回「不重复」时，必须把旧的 RRULE / DURATION 清掉，
                // 否则系统日历仍然按老规则展开。
                putNull(CalendarContract.Events.RRULE)
                putNull(CalendarContract.Events.DURATION)
                put(CalendarContract.Events.DTEND, end)
            }
        }
    }
}

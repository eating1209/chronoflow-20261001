package com.chronoflow.frontend

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 接收通知卡上的「切换分组 / 展开 / 完成」点击，不打开 App。 */
class TaskBarActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == TaskBarOverlayService.ACTION_DISMISS) {
            // 上滑划掉「顶部任务小条」通知 = 关闭悬浮条，且下次回到 App 不再自动恢复。
            TaskBarNotificationCore.setOverlayWanted(context, false)
            TaskBarOverlayService.stop(context)
            return
        }
        if (intent.action != TaskBarNotificationCore.ACTION) {
            return
        }
        try {
            val completed = TaskBarNotificationCore.handleAction(context, intent)
            if (completed != null) {
                TaskBarNotificationModule.notifyCompletion(completed)
            }
        } catch (_: Exception) {
            // 通知点击失败时保留原通知，绝不能把异常抛回系统导致 App 进程崩溃。
        }
    }
}

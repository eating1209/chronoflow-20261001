package com.chronoflow.frontend

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** 注册 {@link TaskBarNotificationModule}。 */
class TaskBarNotificationPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(
            TaskBarNotificationModule(reactContext),
            // 系统日历单向导出；和任务条一样编译进同一个原生包，避免改 MainApplication。
            CalendarSyncModule(reactContext),
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}

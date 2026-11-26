package com.chronoflow.frontend

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * 系统分享面板的轻量接收页。
 *
 * <p>不直接改 MainActivity 的原生代码：这里先收下图片，再把已经在运行的 App 拉到前台。
 * 这样冷启动、后台和前台三种情况都只走一条路，也不会影响原来的启动页与导航。
 */
class ShareReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!SharedImageBridge.capture(this, intent)) {
            finish()
            return
        }
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
        )
        finish()
    }
}

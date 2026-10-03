package io.github.flufy3d.tvshell

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.SparseArray
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * 全屏 WebView 套壳。
 *
 * 按键只在 [dispatchKeyEvent] 一处处理：返回键、映射键、菜单键在这里消费掉（返回 true，不调 super），
 * 不经过 onBackPressed / OnBackInvokedDispatcher（manifest 里 enableOnBackInvokedCallback=false），
 * 所以一次按键只会执行一次动作，与主线程或渲染进程卡多久无关。
 */
class ShellActivity : Activity() {
    private lateinit var cfg: ShellConfig
    private lateinit var root: FrameLayout
    private lateinit var hint: TextView
    private var web: WebView? = null
    private var errorView: View? = null
    private var menuView: View? = null
    private var resumed = false
    private var keyLog: TextView? = null

    private val main = Handler(Looper.getMainLooper())
    private var debug = false
    private var fpsLog = false
    private var dpr: Double? = null

    /** 每个键的按下状态：只认"看到过 repeat=0 的按下"的抬起，长按触发后抬起不再执行短按动作。 */
    private class Press(var down: Boolean = false, var long: Boolean = false)
    private val presses = SparseArray<Press>()

    /** "再按一次退出"的截止时间（uptimeMillis），与第二次按下的 KeyEvent.eventTime 比较。 */
    private var exitArmedUntil = 0L
    /** back.web 时等待网页回复的那次返回（序号）；等待期间新的返回键直接忽略。 */
    private var backPending = 0
    private var backSeq = 0
    private var loadFailed = false
    private var exiting = false
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cfg = ShellConfig.load(this)
        // adb 调试开关：am start -S -n <pkg>/io.github.flufy3d.tvshell.ShellActivity --ez debug true --ez fps true --ef dpr 0
        debug = intent.getBooleanExtra("debug", cfg.debug)
        fpsLog = intent.getBooleanExtra("fps", cfg.fpsLog)
        dpr = if (intent.hasExtra("dpr")) intent.getFloatExtra("dpr", 0f).toDouble().takeIf { it > 0 } else cfg.devicePixelRatio
        Log.i(TAG, "start ${cfg.app} ${cfg.startUrl} shell=${BuildConfig.SHELL_VERSION} debug=$debug fps=$fpsLog dpr=$dpr")

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this).apply { setBackgroundColor(cfg.backgroundColor) }
        hint = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setPadding(dp(24), dp(12), dp(24), dp(12))
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(0xCC000000.toInt()) }
            visibility = View.GONE
        }
        setContentView(root)
        createWebView()
        root.addView(hint, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
            .apply { bottomMargin = dp(48) })
        if (debug) {
            WebView.setWebContentsDebuggingEnabled(true)
            keyLog = TextView(this).apply {
                setTextColor(0xFF00FF66.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                typeface = android.graphics.Typeface.MONOSPACE
                setBackgroundColor(0xB0000000.toInt())
                setPadding(dp(8), dp(6), dp(8), dp(6))
                text = "native keys"
            }
            root.addView(keyLog, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.BOTTOM or Gravity.START)
                .apply { setMargins(dp(8), 0, 0, dp(8)) })
        }
        watchNetwork()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val w = WebView(this)
        web = w
        w.setBackgroundColor(cfg.backgroundColor)
        w.isFocusable = true
        w.isFocusableInTouchMode = true
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
            // 非触摸模式下 WebView 获得焦点时会自动聚焦页面第一个可聚焦元素（关菜单/错误页后 requestFocus 就会触发），
            // 之后确定键会"点击"它。关掉，焦点留在 body。
            @Suppress("DEPRECATION")
            setNeedInitialFocus(false)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            cfg.userAgent?.let { userAgentString = it.replace("{default}", WebSettings.getDefaultUserAgent(this@ShellActivity)) }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            val sw = ServiceWorkerControllerCompat.getInstance()
            sw.serviceWorkerWebSettings.apply {
                cacheMode = WebSettings.LOAD_DEFAULT
                allowContentAccess = false
                allowFileAccess = false
                blockNetworkLoads = false
            }
        }
        w.webViewClient = ShellClient()
        w.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                val line = "${m.message()}  (${m.sourceId().substringAfterLast('/')}:${m.lineNumber()})"
                when (m.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.e(WEB_TAG, line)
                    ConsoleMessage.MessageLevel.WARNING -> Log.w(WEB_TAG, line)
                    else -> Log.i(WEB_TAG, line)
                }
                return true
            }
        }
        installBridge(w)
        installScripts(w)
        root.addView(w, 0, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        w.requestFocus()
        w.loadUrl(cfg.startUrl)
    }

    /** window.TVShellNative：只对允许的源注入（不用 addJavascriptInterface，那个对所有页面和 iframe 都可见）。 */
    private fun installBridge(w: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(TAG, "WEB_MESSAGE_LISTENER 不支持，TVShell.exit() 等接口不可用")
            return
        }
        WebViewCompat.addWebMessageListener(w, "TVShellNative", cfg.origins) { _, msg, origin, isMainFrame, _ ->
            if (!isMainFrame) return@addWebMessageListener
            val o = try { JSONObject(msg.data ?: return@addWebMessageListener) } catch (_: Exception) { return@addWebMessageListener }
            Log.i(TAG, "page($origin): ${o.optString("cmd")}")
            when (o.optString("cmd")) {
                "exit" -> exit("TVShell.exit()")
                "back" -> defaultBack(SystemClock.uptimeMillis())
                "toast" -> showHint(o.optString("arg"))
            }
        }
    }

    /** 在网页自己的脚本之前运行：核心脚本（dpr/UA/按键/TVShell 接口/调试）+ 配置里的自定义脚本。 */
    private fun installScripts(w: WebView) {
        val shellCfg = JSONObject()
            .put("app", cfg.app).put("name", cfg.name).put("version", BuildConfig.SHELL_VERSION)
            .put("dpr", dpr ?: JSONObject.NULL)
            .put("uaData", cfg.userAgentData ?: JSONObject.NULL)
            .put("fixKeyEvents", cfg.fixKeyEvents).put("spatialNavigation", cfg.spatialNavigation)
            .put("debug", debug).put("fps", fpsLog)
        val scripts = buildList {
            add(asset("tvshell/core.js").replace("/*CFG*/null", shellCfg.toString()))
            cfg.scripts.forEach { add(asset("tvshell/inject/$it")) }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            scripts.forEach { WebViewCompat.addDocumentStartJavaScript(w, it, cfg.origins) }
        } else {
            // 退路：页面开始加载时 evaluateJavascript，不保证早于网页脚本
            Log.w(TAG, "DOCUMENT_START_SCRIPT 不支持，改为 onPageStarted 注入")
            fallbackScripts = scripts
        }
    }
    private var fallbackScripts: List<String> = emptyList()

    private fun asset(path: String) = assets.open(path).bufferedReader().use { it.readText() }

    private inner class ShellClient : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            loadFailed = false
            fallbackScripts.forEach { view.evaluateJavascript(it, null) }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            Log.i(TAG, "page finished $url failed=$loadFailed")
            if (!loadFailed) hideError()
        }

        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (!req.isForMainFrame) return
            Log.w(TAG, "load error ${err.errorCode} ${err.description} ${req.url}")
            loadFailed = true
            showError("无法打开 ${cfg.name}", "${err.description}\n请检查网络后重试") { retry() }
        }

        override fun onReceivedHttpError(view: WebView, req: WebResourceRequest, resp: WebResourceResponse) {
            if (!req.isForMainFrame || resp.statusCode < 400) return
            Log.w(TAG, "http error ${resp.statusCode} ${req.url}")
            loadFailed = true
            showError("无法打开 ${cfg.name}", "服务器返回 ${resp.statusCode}") { retry() }
        }

        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val scheme = req.url.scheme ?: return true
            if (scheme == "http" || scheme == "https") return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, req.url))
            } catch (_: ActivityNotFoundException) {
                Log.w(TAG, "no handler for ${req.url}")
            }
            return true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "render process gone, crashed=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}")
            root.removeView(view)
            view.destroy()
            web = null
            showError("页面已停止运行", "可能是内存不足") { recreate() }
            return true
        }
    }

    // ───────────────────────────── 按键 ─────────────────────────────

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (debug) logKey(event)
        val e = cfg.aliases[event.keyCode]?.let { alias(event, it) } ?: event
        val code = e.keyCode
        val menuOpen = menuView != null
        val isBack = code == KeyEvent.KEYCODE_BACK
        val isMenuKey = code in cfg.menuKeys
        val isMenuLong = code == cfg.menuLongPressKey
        val mapped = if (web != null && errorView == null && !menuOpen) cfg.keys[code] else null
        // 方向键/确定键等交给 WebView 原生处理（菜单打开时交给菜单按钮）
        if (!isBack && !isMenuKey && !isMenuLong && mapped == null) return super.dispatchKeyEvent(e)

        val p = presses[code] ?: Press().also { presses.put(code, it) }
        when (e.action) {
            KeyEvent.ACTION_DOWN -> when {
                e.repeatCount == 0 -> {
                    p.down = true
                    p.long = false
                    // 兼做长按菜单键的映射键要等抬起才知道是短按，短按的 keydown/keyup 在抬起时一起发
                    if (mapped != null && !isMenuLong) sendKey(mapped, "keydown", false)
                }
                !p.down || p.long -> {}
                isMenuLong -> { // CEC/adb 的第一次重复（repeatCount=1）带 FLAG_LONG_PRESS
                    p.long = true
                    openMenu("long-press ${KeyEvent.keyCodeToString(code)}")
                }
                mapped != null -> sendKey(mapped, "keydown", true)
            }
            KeyEvent.ACTION_UP -> {
                if (!p.down) return true // 没见过按下的抬起（比如启动前就按住了），丢弃
                p.down = false
                if (p.long || e.isCanceled) return true
                when {
                    isMenuKey -> if (menuOpen) closeMenu() else openMenu(KeyEvent.keyCodeToString(code))
                    isBack -> if (menuOpen) closeMenu() else onBack(e)
                    mapped != null && isMenuLong -> { sendKey(mapped, "keydown", false); sendKey(mapped, "keyup", false) }
                    mapped != null -> sendKey(mapped, "keyup", false)
                }
            }
        }
        return true
    }

    /** 换成别的键码的同一个事件；scanCode 置 0，免得 WebView 按原来的物理键推出 code。 */
    private fun alias(e: KeyEvent, code: Int) =
        KeyEvent(e.downTime, e.eventTime, e.action, code, e.repeatCount, e.metaState, e.deviceId, 0, e.flags, e.source)

    private fun sendKey(k: WebKey, type: String, repeat: Boolean) {
        val q = JSONObject::quote
        web?.evaluateJavascript(
            "window.__tvshell&&window.__tvshell.key(${q(type)},${q(k.key)},${q(k.code)},${k.keyCode},$repeat)", null)
    }

    private fun onBack(e: KeyEvent) {
        val w = web
        if (!cfg.backWeb || w == null || errorView != null) return defaultBack(e.eventTime)
        if (backPending != 0) {
            Log.i(TAG, "back: ignored, waiting for page")
            return
        }
        val seq = ++backSeq
        backPending = seq
        val fallback = Runnable {
            if (backPending != seq) return@Runnable
            backPending = 0
            Log.w(TAG, "back: page did not answer in ${BACK_TIMEOUT}ms, default action")
            defaultBack(e.eventTime)
        }
        main.postDelayed(fallback, BACK_TIMEOUT)
        w.evaluateJavascript("window.__tvshell?window.__tvshell.back():false") { r ->
            if (backPending != seq) return@evaluateJavascript // 已超时并执行过默认动作
            backPending = 0
            main.removeCallbacks(fallback)
            if (r == "true") Log.i(TAG, "back: handled by page (tvshell:back preventDefault)") else defaultBack(e.eventTime)
        }
    }

    /** 能后退就后退；否则按 back.atRoot：提示后 2 秒内再按一次退出 / 打开菜单 / 直接退出。 */
    private fun defaultBack(pressTime: Long) {
        val w = web
        if (w != null && errorView == null && w.canGoBack()) {
            Log.i(TAG, "back: history")
            exitArmedUntil = 0
            w.goBack()
        } else if (cfg.backAtRoot == "exit") {
            exit("back")
        } else if (cfg.backAtRoot == "menu") {
            openMenu("back")
        } else if (pressTime <= exitArmedUntil) {
            exit("back twice")
        } else {
            Log.i(TAG, "back: exit hint")
            exitArmedUntil = SystemClock.uptimeMillis() + EXIT_WINDOW
            showHint(cfg.exitHint, EXIT_WINDOW)
        }
    }

    private fun exit(reason: String) {
        if (exiting) return
        exiting = true
        Log.i(TAG, "exit: $reason")
        finishAndRemoveTask()
    }

    private val keyLines = ArrayDeque<String>()
    private fun logKey(e: KeyEvent) {
        val s = "%s %s rep=%d fl=0x%x src=0x%x dev=%d sc=%d".format(
            if (e.action == KeyEvent.ACTION_DOWN) "DOWN" else if (e.action == KeyEvent.ACTION_UP) "UP  " else "MULT",
            KeyEvent.keyCodeToString(e.keyCode).removePrefix("KEYCODE_"), e.repeatCount, e.flags, e.source, e.deviceId, e.scanCode)
        Log.d(TAG, "key $s")
        keyLines.addLast(s)
        while (keyLines.size > 8) keyLines.removeFirst()
        keyLog?.text = "native\n" + keyLines.joinToString("\n")
    }

    // ───────────────────────────── 界面 ─────────────────────────────

    private val hideHint = Runnable { hint.animate().alpha(0f).setDuration(200).withEndAction { hint.visibility = View.GONE } }

    private fun showHint(text: String, ms: Long = 2000) {
        main.removeCallbacks(hideHint)
        hint.animate().cancel()
        hint.text = text
        hint.alpha = 1f
        hint.visibility = View.VISIBLE
        main.postDelayed(hideHint, ms)
    }

    /**
     * 套壳菜单：继续 / 应用自定义动作 / 刷新 / 退出，只用方向键、确定键、返回键就能操作。
     * 打开期间 WebView.onPause，网页收到 visibilitychange（游戏会自动暂停）。
     */
    private fun openMenu(reason: String) {
        if (menuView != null || exiting) return
        Log.i(TAG, "menu: open ($reason)")
        web?.onPause()
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(32), dp(24), dp(32), dp(24))
            background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(0xF0181820.toInt()) }
        }
        panel.addView(TextView(this).apply {
            text = cfg.name
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { bottomMargin = dp(16) })
        fun item(label: String, action: () -> Unit) = button(label) { action() }.also {
            panel.addView(it, LinearLayout.LayoutParams(dp(280), WRAP_CONTENT).apply { topMargin = dp(10) })
        }
        val first = item("继续") { closeMenu() }
        for (m in cfg.menuItems) item(m.label) {
            closeMenu()
            Log.i(TAG, "menu: ${m.label}")
            m.key?.let { sendKey(it, "keydown", false); sendKey(it, "keyup", false) }
            m.script?.let { web?.evaluateJavascript(it, null) }
        }
        item("刷新") {
            closeMenu()
            Log.i(TAG, "menu: reload")
            if (web == null) recreate() else { hideError(); web?.reload() }
        }
        item("退出") { exit("menu") }
        val scrim = FrameLayout(this).apply { setBackgroundColor(0x99000000.toInt()); isClickable = true }
        scrim.addView(panel, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.CENTER))
        root.addView(scrim, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        menuView = scrim
        first.requestFocus()
    }

    private fun closeMenu() {
        val v = menuView ?: return
        root.removeView(v)
        menuView = null
        if (resumed) web?.onResume()
        errorView?.requestFocus() ?: web?.requestFocus()
    }

    /** 断网且没有缓存、HTTP 错误或渲染进程崩溃时的原生页面：重试 / 退出两个按钮，遥控器可操作。 */
    private fun showError(title: String, detail: String, onRetry: () -> Unit) {
        hideError()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(cfg.backgroundColor)
            isClickable = true
        }
        fun label(t: String, sp: Float, alpha: Float) = TextView(this).apply {
            text = t
            setTextColor(Color.WHITE)
            this.alpha = alpha
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        }
        box.addView(label(title, 28f, 1f))
        box.addView(label(detail, 16f, 0.7f), LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(12) })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val retry = button("重试") { onRetry() }
        row.addView(retry)
        row.addView(button("退出") { exit("error page") }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { leftMargin = dp(24) })
        box.addView(row, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(32) })
        root.addView(box, root.indexOfChild(hint).coerceAtLeast(0), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        errorView = box
        retry.requestFocus()
    }

    private fun hideError() {
        val v = errorView ?: return
        root.removeView(v)
        errorView = null
        web?.requestFocus()
    }

    private fun retry() {
        Log.i(TAG, "retry")
        val w = web ?: return recreate()
        hideError()
        w.reload()
    }

    private fun button(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setTextColor(Color.WHITE)
        setPadding(dp(32), dp(10), dp(32), dp(10))
        fun bg(c: Int) = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(c) }
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), bg(0xFF2979FF.toInt()))
            addState(intArrayOf(), bg(0x40FFFFFF))
        }
        isFocusable = true
        setOnClickListener { onClick() }
    }

    /** 错误页显示期间网络恢复就自动重试。 */
    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post { if (errorView != null && web != null && loadFailed) retry() }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (e: RuntimeException) {
            Log.w(TAG, "network callback: $e")
        }
    }

    private fun immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density + 0.5f).toInt()

    // ───────────────────────────── 生命周期 ─────────────────────────────

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        immersive()
        if (menuView == null) web?.onResume()
    }

    /** WebView.onPause 让页面变为 hidden，网页据此收到 visibilitychange 自动暂停。 */
    override fun onPause() {
        resumed = false
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        netCallback?.let { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
        main.removeCallbacksAndMessages(null)
        web?.let {
            root.removeView(it)
            it.destroy()
        }
        web = null
        super.onDestroy()
    }

    companion object {
        const val TAG = "TVShell"
        const val WEB_TAG = "TVShell-web"
        const val EXIT_WINDOW = 2000L
        const val BACK_TIMEOUT = 1500L
    }
}

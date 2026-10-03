package io.github.flufy3d.tvshell

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.Build
import android.os.SystemClock
import android.view.Choreographer
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.webkit.WebView

/**
 * 光标模式（虚拟鼠标）：方向键移动屏幕上的指针，确定键在指针处点击（触摸），按住确定再移动 = 拖动，
 * 指针推到屏幕边缘时滚动页面（core.js 的 __tvshell.scroll 找滚动容器；跨域 iframe 改用原生滚轮）。
 *
 * 移动由逐帧动画驱动（按下开始、抬起停止），不依赖按键重复：CEC 遥控器按住时约 300ms 才重复一次。
 */
class Cursor(context: Context, private val target: () -> WebView?) {
    /** 指针本身；加到 WebView 之上，用 translation 定位，不触发重新布局。 */
    val view: View = PointerView(context)

    private val density = context.resources.displayMetrics.density
    private val scrollFactor = if (Build.VERSION.SDK_INT >= 26) ViewConfiguration.get(context).scaledVerticalScrollFactor else 64 * density
    private var x = -1f
    private var y = -1f
    private val held = LinkedHashSet<Int>()
    private var holdStart = 0L
    private var lastFrame = 0L
    private var touchDownTime = 0L
    private var running = false
    /** 这次按住期间 JS 滚动不了（指针在跨域 iframe 上），改发原生滚轮事件。 */
    private var nativeWheel = false

    init {
        view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> ensurePosition() } // 第一次布局后把指针放到屏幕中央
    }

    var enabled = false
        set(value) {
            field = value
            reset()
            view.visibility = if (value) View.VISIBLE else View.GONE
            if (value) wake()
        }

    /** 方向键和确定键在光标模式下由这里处理；返回 false 表示不是光标键。 */
    fun handle(e: KeyEvent): Boolean {
        val code = e.keyCode
        val dir = code in DIRS
        val click = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER
        if (!dir && !click) return false
        ensurePosition()
        wake()
        when (e.action) {
            KeyEvent.ACTION_DOWN -> if (e.repeatCount == 0) {
                if (dir) {
                    if (held.isEmpty()) nativeWheel = false
                    held.add(code)
                    holdStart = SystemClock.uptimeMillis()
                    val (dx, dy) = direction(code)
                    move(dx * STEP_DP * density, dy * STEP_DP * density) // 短按先走一小步，方便精确对准
                    startFrames()
                } else {
                    touchDownTime = SystemClock.uptimeMillis()
                    view.scaleX = 0.8f
                    view.scaleY = 0.8f
                    touch(MotionEvent.ACTION_DOWN)
                }
            }
            KeyEvent.ACTION_UP -> if (dir) {
                held.remove(code)
            } else if (touchDownTime != 0L) {
                touch(if (e.isCanceled) MotionEvent.ACTION_CANCEL else MotionEvent.ACTION_UP)
                touchDownTime = 0L
                view.scaleX = 1f
                view.scaleY = 1f
            }
        }
        return true
    }

    /** 打开菜单、Activity 暂停时调用：停止移动，未完成的触摸取消掉。 */
    fun reset() {
        held.clear()
        if (touchDownTime != 0L) touch(MotionEvent.ACTION_CANCEL)
        touchDownTime = 0L
        view.scaleX = 1f
        view.scaleY = 1f
    }

    private fun ensurePosition() {
        val p = view.parent as? View ?: return
        if (p.width == 0) return
        if (x < 0 || x >= p.width || y < 0 || y >= p.height) {
            x = p.width / 2f
            y = p.height / 2f
            place()
        }
    }

    private fun direction(code: Int) = when (code) {
        KeyEvent.KEYCODE_DPAD_LEFT -> -1 to 0
        KeyEvent.KEYCODE_DPAD_RIGHT -> 1 to 0
        KeyEvent.KEYCODE_DPAD_UP -> 0 to -1
        else -> 0 to 1
    }

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            val now = SystemClock.uptimeMillis()
            if (held.isEmpty() || !enabled) {
                running = false
                return
            }
            val dt = ((now - lastFrame).coerceIn(0, 50)) / 1000f
            lastFrame = now
            val t = (now - holdStart - HOLD_DELAY_MS) / 1000f
            if (t > 0) {
                val speed = (MIN_SPEED_DP + ACCEL_DP * t).coerceAtMost(MAX_SPEED_DP) * density
                var dx = 0
                var dy = 0
                for (c in held) direction(c).let { dx += it.first; dy += it.second }
                move(dx * speed * dt, dy * speed * dt)
            }
            wake()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun startFrames() {
        if (running) return
        running = true
        lastFrame = SystemClock.uptimeMillis()
        Choreographer.getInstance().postFrameCallback(frame)
    }

    private fun move(dx: Float, dy: Float) {
        val p = view.parent as? View ?: return
        val nx = (x + dx).coerceIn(0f, p.width - 1f)
        val ny = (y + dy).coerceIn(0f, p.height - 1f)
        val overX = x + dx - nx
        val overY = y + dy - ny
        x = nx
        y = ny
        place()
        if (touchDownTime != 0L) touch(MotionEvent.ACTION_MOVE) else hover()
        if (overX != 0f || overY != 0f) scroll(overX, overY)
    }

    private fun place() {
        view.translationX = x
        view.translationY = y
    }

    // ── 发给 WebView 的事件：点击用触摸（兼容性最好），悬停和滚动用鼠标 ──

    private fun touch(action: Int) {
        val w = target() ?: return
        val down = if (touchDownTime != 0L) touchDownTime else SystemClock.uptimeMillis()
        val ev = event(down, action, InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.TOOL_TYPE_FINGER)
        w.dispatchTouchEvent(ev)
        ev.recycle()
    }

    private fun hover() {
        val w = target() ?: return
        val ev = event(SystemClock.uptimeMillis(), MotionEvent.ACTION_HOVER_MOVE, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE)
        w.dispatchGenericMotionEvent(ev)
        ev.recycle()
    }

    /** 指针被边缘挡住的那部分位移换成页面滚动：往下推 = 看下面的内容。 */
    private fun scroll(overX: Float, overY: Float) {
        val w = target() ?: return
        val p = view.parent as? View ?: return
        if (!nativeWheel) {
            val dx = overX * SCROLL_GAIN / density
            val dy = overY * SCROLL_GAIN / density
            w.evaluateJavascript("window.__tvshell?window.__tvshell.scroll(${x / p.width},${y / p.height},$dx,$dy):false") {
                if (it != "true") nativeWheel = true
            }
            return
        }
        val ev = event(SystemClock.uptimeMillis(), MotionEvent.ACTION_SCROLL, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE) {
            it.setAxisValue(MotionEvent.AXIS_VSCROLL, -overY * SCROLL_GAIN / scrollFactor)
            it.setAxisValue(MotionEvent.AXIS_HSCROLL, overX * SCROLL_GAIN / scrollFactor)
        }
        w.dispatchGenericMotionEvent(ev)
        ev.recycle()
    }

    private fun event(downTime: Long, action: Int, source: Int, tool: Int, axes: (MotionEvent.PointerCoords) -> Unit = {}): MotionEvent {
        val props = MotionEvent.PointerProperties().apply { id = 0; toolType = tool }
        val coords = MotionEvent.PointerCoords().apply { this.x = this@Cursor.x; this.y = this@Cursor.y; pressure = 1f; size = 1f; axes(this) }
        return MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, 1, arrayOf(props), arrayOf(coords),
            0, 0, 1f, 1f, 0, 0, source, 0)
    }

    // ── 闲置自动隐藏 ──

    private val fade = Runnable { view.animate().alpha(0f).setDuration(300) }

    private fun wake() {
        view.removeCallbacks(fade)
        view.animate().cancel()
        view.alpha = 1f
        view.postDelayed(fade, IDLE_HIDE_MS)
    }

    /** 经典箭头指针，尖端在 (0,0)。 */
    private class PointerView(context: Context) : View(context) {
        private val d = context.resources.displayMetrics.density
        private val path = Path().apply {
            val pts = floatArrayOf(0f, 0f, 0f, 17f, 4f, 13.5f, 7f, 20f, 10f, 18.8f, 7.2f, 12.5f, 12.5f, 12.5f)
            moveTo(pts[0] * d * 1.3f, pts[1] * d * 1.3f)
            for (i in 2 until pts.size step 2) lineTo(pts[i] * d * 1.3f, pts[i + 1] * d * 1.3f)
            close()
        }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = 1.5f * d; strokeJoin = Paint.Join.ROUND
        }

        init {
            pivotX = 0f
            pivotY = 0f
            isFocusable = false
            isClickable = false
        }

        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) =
            setMeasuredDimension((20 * d).toInt(), (30 * d).toInt())

        override fun onDraw(canvas: Canvas) {
            canvas.drawPath(path, fill)
            canvas.drawPath(path, stroke)
        }
    }

    companion object {
        private val DIRS = setOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN)
        private const val STEP_DP = 10f          // 短按一次的位移
        private const val HOLD_DELAY_MS = 220L   // 按住多久后开始连续移动（CEC 短按约 150–200ms）
        private const val MIN_SPEED_DP = 220f    // 连续移动的起始速度（dp/s），屏幕约 960x540dp
        private const val ACCEL_DP = 700f        // 每秒加速
        private const val MAX_SPEED_DP = 900f
        private const val SCROLL_GAIN = 2.5f     // 边缘滚动比指针移动快一些
        private const val IDLE_HIDE_MS = 5000L
    }
}

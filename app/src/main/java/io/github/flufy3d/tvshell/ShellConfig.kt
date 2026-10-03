package io.github.flufy3d.tvshell

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject

/** 网页键盘事件的三元组，派发 keydown/keyup 时原样带上。 */
data class WebKey(val key: String, val code: String, val keyCode: Int)

/** 菜单里的应用自定义动作：向网页发一次按键（keydown+keyup），或者执行一段脚本。 */
data class MenuItem(val label: String, val key: WebKey?, val script: String?)

/**
 * 运行期配置：assets/tvshell/config.json，由 build.ps1 从 apps/<name>.json 解析并补全默认值后生成。
 * 字段含义见 README。
 */
class ShellConfig(private val j: JSONObject) {
    val app: String = j.optString("app", "app")
    val name: String = j.optString("name", app)
    val url: String = j.getString("url")
    val startUrl: String = appendQuery(url, j.optString("appendQuery", ""))
    val backgroundColor: Int = parseColor(j.optString("backgroundColor", "#000000"))

    /** 允许注入脚本和 TVShell 接口的源：网址本身的源 + 配置里的 origins。 */
    val origins: Set<String> = buildSet {
        add(originOf(url))
        j.optJSONArray("origins")?.strings()?.forEach { add(it.trimEnd('/')) }
    }

    private val back: JSONObject = j.optJSONObject("back") ?: JSONObject()
    /** 先向网页派发可取消的 tvshell:back，网页 preventDefault 了就不再处理。 */
    val backWeb: Boolean = back.optBoolean("web", false)
    /** 没有历史可后退时：confirm 提示"再按一次退出"，menu 打开套壳菜单，exit 直接退出。 */
    val backAtRoot: String = back.optString("atRoot", "confirm").also {
        require(it in setOf("confirm", "menu", "exit")) { "back.atRoot 只能是 confirm / menu / exit：$it" }
    }
    val exitHint: String = back.optString("exitHint", "再按一次返回键退出")

    /** 套壳菜单：长按 longPress 键或短按 keys 里的键打开。所有遥控器都有返回键，所以默认长按返回。 */
    private val menu: JSONObject = j.optJSONObject("menu") ?: JSONObject()
    val menuLongPressKey: Int = menu.optString("longPress", "BACK").let { if (it.isEmpty()) 0 else knownKey(it, "menu.longPress") }
    val menuKeys: Set<Int> = (menu.optJSONArray("keys")?.strings() ?: listOf("MENU", "TV_CONTENTS_MENU")).map { knownKey(it, "menu.keys") }.toSet()
    val menuItems: List<MenuItem> = menu.optJSONArray("items")?.let { a ->
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            MenuItem(o.getString("label"), o.opt("key")?.let { webKeyOf(it) }, o.optString("script").takeIf { it.isNotEmpty() })
        }
    } ?: emptyList()

    /** 按键归一化：各种遥控器、手柄的"确定""返回"键码不同，先换成同一个键码再处理。 */
    val aliases: Map<Int, Int> = buildMap {
        val o = j.optJSONObject("aliases") ?: JSONObject()
        for (from in o.keys()) if (!o.isNull(from)) put(knownKey(from, "aliases"), knownKey(o.getString(from), "aliases"))
    }

    /** 遥控器键 → 网页键盘事件。返回键只按 back 策略处理，不能映射。 */
    val keys: Map<Int, WebKey> = buildMap {
        val o = j.optJSONObject("keys") ?: JSONObject()
        for (name in o.keys()) {
            val code = knownKey(name, "keys")
            require(code != KeyEvent.KEYCODE_BACK) { "keys: 返回键不能映射，它由 back 配置处理" }
            if (o.isNull(name)) continue // 显式写 null = 取消默认映射，交给 WebView 原生处理
            put(code, webKeyOf(o.get(name)))
        }
    }

    private val inject: JSONObject = j.optJSONObject("inject") ?: JSONObject()
    val devicePixelRatio: Double? = inject.optDouble("devicePixelRatio").takeIf { !it.isNaN() && it > 0 }
    val userAgent: String? = inject.optString("userAgent").takeIf { it.isNotEmpty() && it != "null" }
    val userAgentData: JSONObject? = inject.optJSONObject("userAgentData")
    val fixKeyEvents: Boolean = inject.optBoolean("fixKeyEvents", true)
    val spatialNavigation: Boolean = inject.optBoolean("spatialNavigation", true)
    val scripts: List<String> = inject.optJSONArray("scripts")?.strings() ?: emptyList()

    val debug: Boolean = j.optBoolean("debug", false)
    val fpsLog: Boolean = j.optBoolean("fpsLog", false)

    companion object {
        fun load(ctx: Context): ShellConfig =
            ShellConfig(JSONObject(ctx.assets.open("tvshell/config.json").bufferedReader().use { it.readText() }))

        fun keyCodeOf(name: String): Int {
            val n = name.trim().uppercase()
            // "3" 是数字键 3（KEYCODE_3），不是键码 3（HOME）
            return KeyEvent.keyCodeFromString(if (n.startsWith("KEYCODE_")) n else "KEYCODE_$n")
        }

        private fun knownKey(name: String, field: String): Int =
            keyCodeOf(name).also { require(it != KeyEvent.KEYCODE_UNKNOWN) { "$field: 未知的安卓按键 $name" } }

        /** "Escape" / "KeyA" / "Digit1" / "ArrowLeft"…，或者 {"key","code","keyCode"} 对象。 */
        fun webKeyOf(v: Any): WebKey {
            if (v is JSONObject) return WebKey(v.getString("key"), v.optString("code", ""), v.optInt("keyCode", 0))
            val code = v.toString()
            NAMED[code]?.let { return it }
            Regex("^Key([A-Z])$").find(code)?.let { return WebKey(it.groupValues[1].lowercase(), code, it.groupValues[1][0].code) }
            Regex("^Digit([0-9])$").find(code)?.let { return WebKey(it.groupValues[1], code, 48 + it.groupValues[1].toInt()) }
            Regex("^F([1-9]|1[0-2])$").find(code)?.let { return WebKey(code, code, 111 + it.groupValues[1].toInt()) }
            throw IllegalArgumentException("keys: 未知的网页按键 $code（可写成 {\"key\",\"code\",\"keyCode\"}）")
        }

        private val NAMED = listOf(
            WebKey("Enter", "Enter", 13), WebKey("Escape", "Escape", 27), WebKey(" ", "Space", 32),
            WebKey("Tab", "Tab", 9), WebKey("Backspace", "Backspace", 8),
            WebKey("ArrowLeft", "ArrowLeft", 37), WebKey("ArrowUp", "ArrowUp", 38),
            WebKey("ArrowRight", "ArrowRight", 39), WebKey("ArrowDown", "ArrowDown", 40),
            WebKey("PageUp", "PageUp", 33), WebKey("PageDown", "PageDown", 34),
            WebKey("End", "End", 35), WebKey("Home", "Home", 36),
        ).associateBy { it.code }

        fun originOf(url: String): String {
            val u = Uri.parse(url)
            return "${u.scheme}://${u.host}" + if (u.port != -1) ":${u.port}" else ""
        }

        fun appendQuery(url: String, query: String): String {
            val q = query.trim().trimStart('?', '&')
            if (q.isEmpty()) return url
            val hash = url.indexOf('#').let { if (it < 0) url.length else it }
            val base = url.substring(0, hash)
            return base + (if ('?' in base) "&" else "?") + q + url.substring(hash)
        }

        private fun parseColor(s: String): Int = try {
            Color.parseColor(s)
        } catch (_: IllegalArgumentException) {
            Color.BLACK
        }

        private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
    }
}

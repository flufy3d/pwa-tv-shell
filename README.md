# pwa-tv-shell

一套安卓电视套壳代码，加上每个网页应用一份配置文件，一条命令就能为每个应用生成**独立的 APK**：各自有包名、桌面图标、电视横幅和存储。

- 原生 Kotlin 加系统 WebView，唯一的依赖是 `androidx.webkit`，release 包大约 140 KB
- 不用 Capacitor、Cordova 或 TWA（盒子上没有 Chrome，TWA 跑不起来）
- 网页源码一行都不用改，电视适配全部由套壳完成：按键修复和映射、返回键、套壳菜单、在网页脚本之前注入脚本
- 只要遥控器有**方向键、确定键、返回键**，就能用到全部功能。彩色键、菜单键只是可选的快捷方式

目标设备是小米盒子 S 三代（MiTV-AFMU0，Google TV，Android 14，32 位），用电视遥控器经 HDMI-CEC 控制。其他 Android 7 以上的电视盒子也能用（minSdk 24）。

## 快速开始

```powershell
./build.ps1 neon-racer            # 生成 dist/neon-racer.apk
./install.ps1 neon-racer -Run     # adb 安装到盒子并启动
```

PowerShell 7 和系统自带的 Windows PowerShell 5.1 都能运行。5.1 默认禁止执行脚本，这时用：

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 neon-racer
```

### 环境

`tools/env.ps1` 默认从 `%USERPROFILE%\tools` 查找以下工具，都可以用环境变量覆盖：

| 内容 | 默认值 | 覆盖用的环境变量 |
|---|---|---|
| JDK 17 | `tools\jdk-17*` | `JAVA_HOME` |
| Android SDK（platform 36，build-tools 35/36） | `tools\android-sdk` | `ANDROID_HOME` |
| 工具根目录 | `%USERPROFILE%\tools` | `TVSHELL_TOOLS` |
| 盒子 adb 地址 | `100.108.156.33:5555` | `TVSHELL_DEVICE`，或 `install.ps1 -Serial` |

Gradle 用仓库里的 wrapper（8.14.3），AGP 8.13.2，Kotlin 2.4.10。

### 签名

第一次编译时会在 `keystore/` 下自动生成 `tvshell.jks` 和 `keystore.properties`（已加入 gitignore）。所有应用共用这一个签名，以后才能覆盖升级安装。**请备份 `keystore/` 目录**：丢了就只能先卸载再装，应用数据也会跟着丢。

## 新增一个应用

1. 新建 `apps/<名字>.json`。名字只能用小写字母、数字、`-` 和 `_`，最少只需要两个字段：

   ```json
   {
     "url": "https://example.com/app/",
     "applicationId": "io.github.flufy3d.tv.example"
   }
   ```

2. 运行 `./build.ps1 <名字>`。名称、图标、背景色会从网站的 `manifest.webmanifest` 里自动读取。
3. 运行 `./install.ps1 <名字> -Run`。
4. 加 `-DebugKeys` 启动，看看遥控器的每个键传到网页后变成了什么，再按需调整 `keys`、`menu.items`、`inject.spatialNavigation` 等字段。

`build.ps1` 做了这些事：

- 读取 `defaults.json` 和 `apps/<名字>.json` 并深度合并
- 从网页的 `<link rel="manifest">` 找到 manifest，下载 manifest 和图标，缓存在 `build/gen/<名字>/download/`（加 `-Refresh` 重新下载）
- 用 System.Drawing 生成各密度的 mipmap 图标、自适应图标前景，以及 320x180 的电视横幅（背景色 + 图标 + 名称）
- 把运行期配置写进 `assets/tvshell/config.json`，把注入脚本复制进 assets
- 调用 `gradlew assembleRelease -Papp=<名字>`，Gradle 再从 `build/gen/<名字>/` 读取包名、版本和资源目录
- 把 APK 复制到 `dist/<名字>.apk`

## 配置字段

所有字段的默认值见 [`defaults.json`](defaults.json)。应用配置会和默认值深度合并：对象按字段合并，其他类型直接覆盖。

| 字段 | 默认 | 含义 |
|---|---|---|
| `url` | 必填 | 入口网址 |
| `applicationId` | 必填 | 安卓包名。不同的包名就是不同的 App，各自有独立的存储（localStorage、IndexedDB、SW 缓存） |
| `name` | manifest 的 `short_name`，没有就用 `name` | 桌面上显示的名称 |
| `bannerText` | manifest 的 `name` | 横幅上的文字，放不下会自动缩小字号，最多两行 |
| `icon` | manifest 里最大的 PNG 图标 | 图标的 URL，或者相对 `apps/` 的本地路径（只支持 PNG/JPG） |
| `iconMaskable` | 从 manifest 的 `purpose` 判断 | 图标是否为 maskable（全出血）。决定自适应图标前景的缩放比例 |
| `backgroundColor` | manifest 的 `background_color`，没有就用 `#000000` | 窗口、WebView、横幅和错误页的背景色，格式 `#rgb` 或 `#rrggbb` |
| `iconBackgroundColor` | 同 `backgroundColor` | 自适应图标的背景层颜色 |
| `manifest` | 自动从网页查找 | 手动指定 manifest 的 URL |
| `versionCode` | `1` | 安卓版本号。覆盖安装时不能比已安装的小 |
| `versionName` | 套壳版本（`VERSION` 文件） | 显示用的版本名 |
| `orientation` | `"landscape"` | 屏幕方向，对应 `android:screenOrientation` |
| `appendQuery` | `""` | 追加到网址后面的参数，例如 `"tv=1"`，网页可以据此判断自己在电视上运行 |
| `origins` | `[]` | 除 `url` 自身的源以外，还允许注入脚本和使用 `TVShell` 接口的源，例如 `["https://cdn.example.com"]` |
| `back.web` | `false` | 返回键先交给网页：派发可取消的 `tvshell:back` 事件，见下文 |
| `back.atRoot` | `"confirm"` | 没有历史可后退时怎么办：`confirm` 提示后 2 秒内再按一次退出，`menu` 打开套壳菜单，`exit` 直接退出 |
| `back.exitHint` | `"再按一次返回键退出 · 长按返回键打开菜单"` | `confirm` 提示的文字 |
| `menu.longPress` | `"BACK"` | 长按这个键打开套壳菜单。写 `""` 表示不用长按 |
| `menu.keys` | `["MENU", "TV_CONTENTS_MENU"]` | 短按就打开或关闭菜单的键 |
| `menu.items` | `[]` | 菜单里的应用自定义动作，见下文 |
| `aliases` | 见下文 | 按键归一化：先把某个键码换成另一个键码，再按换后的键处理 |
| `keys` | `{}` | 遥控器键到网页键盘事件的映射，见下文 |
| `inject.devicePixelRatio` | `null` | 覆盖网页读到的 `window.devicePixelRatio`，只影响网页按它算出来的渲染分辨率，CSS 布局不变 |
| `inject.userAgent` | `null` | 覆盖 UA。`{default}` 会被替换成系统 WebView 的原始 UA，例如 `"{default} MyTV/1.0"` |
| `inject.userAgentData` | `null` | 覆盖 `navigator.userAgentData` 的 `mobile` 和 `platform`，例如 `{"mobile": false}` |
| `inject.fixKeyEvents` | `true` | 修复原生按键事件的 `code` 和 `repeat`，见"实测发现" |
| `inject.spatialNavigation` | `true` | 是否保留 WebView 的空间导航（方向键在按钮之间移动焦点）。游戏类应用设为 `false` |
| `inject.scripts` | `[]` | 自定义注入脚本，路径相对 `apps/`，在网页脚本之前、核心脚本之后运行 |
| `debug` | `false` | 默认就打开调试叠层（一般用 `install.ps1 -DebugKeys` 临时打开） |
| `fpsLog` | `false` | 默认就输出帧率日志（一般用 `install.ps1 -Fps` 临时打开） |

### 遥控器兼容

不同遥控器能发出的键差别很大。小米盒子自带的遥控器没有彩色键；HDMI-CEC 传过来的电视遥控器没有 Home、菜单和音量；手柄的确定、返回是 `BUTTON_A`、`BUTTON_B`。所以套壳的设计原则是：**只用方向键、确定键、返回键就能用到全部功能**，其他键都只是快捷方式。

- **套壳菜单**：长按返回键（`menu.longPress`），或者按菜单键（`menu.keys`）打开。`back.atRoot` 设为 `menu` 时，在首页短按返回也会打开。菜单里依次是"继续"、应用自定义动作（`menu.items`）、"刷新"、"退出"，用方向键选择、确定键执行、返回键关闭。菜单打开期间调用 `WebView.onPause()`，网页会收到 `visibilitychange`，游戏会自动暂停。菜单是原生界面，网页卡死了也能打开，用来退出最可靠
- **按键归一化 `aliases`**：默认把 `BUTTON_A` 当作确定键（`DPAD_CENTER`）、`BUTTON_B` 当作返回键、`BUTTON_START` 当作菜单键。归一化之后的键走和原生键完全一样的逻辑，所以手柄也能操作网页和菜单。注意：用 Gamepad API 的网页游戏需要把这些别名设为 `null`（例如 `"aliases": {"BUTTON_A": null}`），否则手柄按键会被套壳拿走。遥控器的返回键如果发的是 `ESCAPE`，可以加上 `"ESCAPE": "BACK"`
- **快捷键 `keys`**：彩色键、频道键、数字键可以映射成网页按键，作为有这些键的遥控器上的快捷方式。不要把只能靠快捷键才能用的功能留给用户，应该在 `menu.items` 里也放一份
- 确定键发 `ENTER` 或 `NUMPAD_ENTER` 的遥控器，WebView 和菜单按钮都能原生处理，不需要归一化

实测能经 CEC 传到小米盒子的键有：方向键、确定键、BACK、CHANNEL_UP/DOWN、数字 0–9、PROG_RED/GREEN/YELLOW/BLUE。Home、菜单、设置、音量都传不过来。CEC 的长按会在大约 300ms 后发出第一次重复（带 `FLAG_LONG_PRESS`），可以识别。

### 菜单项 `menu.items`

```json
"menu": {
  "items": [
    { "label": "成就档案", "script": "neonRacerTV.toggleArchive()" },
    { "label": "帮助", "key": "F1" }
  ]
}
```

`script` 是在页面里执行的一段 JS，通常调用 `inject.scripts` 里定义的函数。`key` 是向网页发一次按键（keydown + keyup），写法和 `keys` 的值相同。两个都写就先发按键再执行脚本。菜单关闭、网页恢复之后才会执行。

### 按键映射 `keys`

键是安卓键名，可以省略 `KEYCODE_` 前缀，例如 `PROG_RED`、`CHANNEL_UP`、`3`（数字键 3）。

值是网页按键的 `code`，支持 `Enter`、`Escape`、`Space`、`Tab`、`Backspace`、`ArrowLeft/Up/Right/Down`、`PageUp/PageDown/Home/End`、`KeyA`–`KeyZ`、`Digit0`–`Digit9` 和 `F1`–`F12`。也可以写成完整的对象 `{"key": "x", "code": "KeyX", "keyCode": 88}`。值写 `null` 表示取消映射。

映射的键会在原生侧被消费掉，然后通过 `evaluateJavascript` 向网页的焦点元素派发合成的 keydown/keyup（带 key、code、keyCode）：

- 按住时，重复的 keydown 带 `repeat=true`，松开时发 keyup
- 合成事件的 `isTrusted` 是 false，不算用户激活
- 返回键不能映射，它由 `back` 配置处理
- 没有映射的键（包括方向键和确定键）交给 WebView 原生处理（原因见"实测发现"）

### 返回键

处理顺序：

1. 菜单开着：关闭菜单
2. `back.web` 为 true 时：向网页派发可取消的 `tvshell:back` 事件。网页调用了 `preventDefault()` 就到此为止。网页 1.5 秒内没有响应（比如卡住了）就继续往下走
3. 页面能后退：后退
4. 按 `back.atRoot` 处理：`confirm` 提示"再按一次返回键退出"，2 秒内再按一次就退出；`menu` 打开菜单；`exit` 直接退出

长按返回键（`menu.longPress`）任何时候都会打开菜单。

**返回键只在一个地方处理**：`ShellActivity.dispatchKeyEvent`。

- 事件在这里被消费掉，不会再进入 `onBackPressed` 或 `OnBackInvokedDispatcher`
- manifest 里设了 `enableOnBackInvokedCallback="false"`，所以 targetSdk 36 的预测性返回也不会插手
- 动作只在"看到过按下之后的抬起"时执行一次，不靠时间窗口去重；长按触发菜单后，这次的抬起不再执行短按动作
- 主线程不做截图之类的重活

因此不会出现 TV Bro（[truefedex/tv-bro#282](https://github.com/truefedex/tv-bro/issues/282)）那种主线程一卡、一次返回被执行两次的问题。

## 网页接口（可选）

网页不接入也能正常工作。接口只会注入到 `url` 和 `origins` 对应的源（用的是 `WebViewCompat.addWebMessageListener`，不是对所有页面都可见的 `addJavascriptInterface`）。

```js
if (window.TVShell) {
  TVShell.version;        // 套壳版本
  TVShell.app;            // 应用名（apps/<名字>.json 的名字）
  TVShell.exit();         // 退出 App
  TVShell.back();         // 执行套壳的默认返回（后退，或按 back.atRoot 处理）
  TVShell.toast('文字');  // 屏幕底部提示 2 秒
}

// 仅在 back.web = true 时触发
addEventListener('tvshell:back', e => {
  if (menuOpen) { closeMenu(); e.preventDefault(); }  // 自己处理了，就不再执行默认返回
});
```

## 调试

```powershell
./install.ps1 neon-racer -Run -DebugKeys        # 装完启动，打开按键叠层
./install.ps1 neon-racer -NoInstall -Fps        # 只重启，输出帧率日志
./install.ps1 neon-racer -NoInstall -Fps -Dpr 0 # 临时不覆盖 devicePixelRatio（对比帧率用）
```

- `-DebugKeys`：屏幕左下角显示原生收到的 KeyEvent（键名、repeat、flags、source、deviceId、scanCode），右下角显示网页实际收到的 keydown/keyup（key、code、keyCode、repeat、isTrusted、是否被修复或映射、是否被 preventDefault、焦点元素）。同时开启 `chrome://inspect` 远程调试
- `-Fps`：每 5 秒把 rAF 帧率、最慢一帧、超过 33ms 的帧数、canvas 实际绘制尺寸打到 logcat
- 这些参数本质上是 `am start -S ... --ez debug true --ez fps true --ef dpr <值>`，所以每次都会冷启动

查看日志：

```sh
adb -s 100.108.156.33:5555 logcat -s TVShell TVShell-web
```

`TVShell` 是套壳自己的日志（按键、返回键动作、菜单、退出原因、加载错误）。`TVShell-web` 是网页的 console 输出。

## 实测发现（小米盒子 S 三代，WebView 153）

- **原生方向键和确定键传进网页后 `code` 是空字符串。** WebView 根据 scanCode 推算 `code`，而 CEC 和 adb 注入的按键 scanCode=0。确定键在网页里是 `key="Enter"`、`keyCode=13`、`code=""`。`inject.fixKeyEvents` 会在 window 捕获阶段（比网页的所有监听都早）按 `key` 把 `code` 补上。事件仍然是原生的，所以确定键不需要再映射成合成的 Enter
- **长按产生的重复 keydown 传进网页后 `repeat` 是 false。** 网页常用 `if (e.repeat) return` 过滤重复，不修的话按住上键会每 300ms 跳一次。`fixKeyEvents` 会把"没松开又按下"的事件标成 `repeat=true`
- **没有触摸屏的设备上，WebView 默认开启空间导航。** 网页没有 preventDefault 的方向键会把焦点移到按钮上，之后再按确定键，就会"点击"这个按钮（neon-racer 因此会在开局的同时误打开成就面板）。`inject.spatialNavigation: false` 会对方向键 preventDefault，网页自己的监听照常收到
- **WebView 重新获得焦点时会自动聚焦页面里第一个可聚焦元素**（关菜单、关错误页后 `requestFocus()` 就会触发），之后确定键会"点击"它。套壳设了 `setNeedInitialFocus(false)` 来避免
- **2GB 内存很紧张。** 游戏进程常驻 190–285 MB，切到后台后经常被 lmkd 立刻杀掉（`low watermark is breached and swap is low`），再打开就是冷启动。没被杀的情况下，`onPause` 会让页面收到 `visibilitychange`，已验证
- 网页里 `devicePixelRatio=2`，视口 960x540，`hardwareConcurrency=4`，`deviceMemory=2`，`navigator.userAgentData.mobile=true`，UA 中带 `Mobile`

## neon-racer 的配置

[`apps/neon-racer.json`](apps/neon-racer.json)：

- `back.atRoot: "menu"`：游戏中按返回直接打开菜单，游戏同时暂停。"再按一次退出"的提示期间游戏还在跑，容易撞毁
- 菜单项"成就档案"：调用 [`apps/neon-racer.tv.js`](apps/neon-racer.tv.js) 里的 `neonRacerTV.toggleArchive()`。游戏里的打开按钮原本只能用鼠标点
- `back.web: true`：成就面板开着时，返回键先关面板（`neon-racer.tv.js` 处理 `tvshell:back`）
- 快捷键（只对有彩色键的遥控器有用）：红键映射成 `Escape` 关闭面板，绿键映射成 `F2` 打开或关闭面板
- `spatialNavigation: false`，避免开局时误点按钮
- `devicePixelRatio: 1`

操作方式：方向键左右移动、上跳、下滑铲，确定键开局，返回键打开菜单（继续 / 成就档案 / 刷新 / 退出）。

### 帧率对比

测试方法：先在开始页停 10 秒，然后每 8 秒按一次确定键反复开局（没人操作，每局大约 7 秒就会撞毁）。每 5 秒一个窗口：

| | 开始页 fps | 游戏中 fps（各 5 秒窗口） | canvas 尺寸 |
|---|---|---|---|
| 注入 dpr=1 | 31.1 / 36.0 | 37.4, 59.4, 55.2, 46.7, 41.9, 40.4, 45.6 | 672x378 – 768x432 |
| 原生 dpr=2 | 29.8 / 34.0 | 33.3, 58.0, 55.2, 59.6, 52.8, 52.4, 59.8 | 672x378 – 1056x594 |

游戏自带按帧率自适应分辨率的逻辑。判定为手机低配时，pixelRatio 在 0.7 到 min(dpr, 1.5) 之间调整，所以两种情况都会自己降档。注入 dpr=1 只是把上限从 1.5 压到 1.0，帧率并没有明显提升；不注入时，游戏反而能升到 1.1 倍分辨率并接近 60fps。开始页两种情况都只有 30–36fps，canvas 尺寸也相同，瓶颈应该不在 WebGL 的分辨率上。

## 目录结构

```
apps/                 每个应用的配置和注入脚本
defaults.json         所有配置字段的默认值
build.ps1             解析配置、生成资源、编译 → dist/<名字>.apk
install.ps1           adb 安装、启动、调试开关
tools/env.ps1         JDK/SDK/adb 路径，以及兼容 PowerShell 5.1 的小工具
app/                  安卓套壳（唯一的一份代码）
  src/main/java/.../ShellActivity.kt   WebView、按键、返回键、菜单、错误页、生命周期
  src/main/java/.../ShellConfig.kt     运行期配置解析
  src/main/assets/tvshell/core.js      文档开始脚本：dpr/UA 覆盖、按键修复、合成按键、TVShell 接口、调试叠层、帧率
build/gen/<名字>/     生成的资源、assets、build.json（Gradle 从这里读）
dist/                 生成的 APK
keystore/             签名（gitignore，请备份）
```

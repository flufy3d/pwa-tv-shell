<#
.SYNOPSIS
  为 apps/<App>.json 描述的网页应用生成独立 APK：dist/<App>.apk
.EXAMPLE
  ./build.ps1 neon-racer
  ./build.ps1 neon-racer -Refresh   # 重新下载 manifest 和图标（默认用 build/gen/<App>/download 里的缓存）
#>
param(
    [Parameter(Mandatory, Position = 0)][string]$App,
    [switch]$Refresh
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
. (Join-Path $Root 'tools/env.ps1')
Add-Type -AssemblyName System.Drawing

$appFile = Join-Path $Root "apps/$App.json"
if (-not (Test-Path $appFile)) { throw "找不到配置 $appFile" }
if ($App -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw "应用名只能用小写字母、数字、- 和 _：$App" }

function Merge-Config($base, $over) {
    $r = [ordered]@{}
    # 用 PSBase.Keys：配置里有个叫 keys 的字段，$dict.Keys 会取到它的值
    foreach ($k in $base.PSBase.Keys) { $r[$k] = $base[$k] }
    foreach ($k in $over.PSBase.Keys) {
        if ($r[$k] -is [Collections.IDictionary] -and $over[$k] -is [Collections.IDictionary]) { $r[$k] = Merge-Config $r[$k] $over[$k] }
        else { $r[$k] = $over[$k] }
    }
    $r
}
$cfg = Merge-Config (Read-JsonFile (Join-Path $Root 'defaults.json')) (Read-JsonFile $appFile)
foreach ($k in 'url', 'applicationId') { if (-not $cfg[$k]) { throw "$appFile 缺少 $k" } }
if ($cfg.applicationId -notmatch '^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$') { throw "applicationId 不合法：$($cfg.applicationId)" }
$shellVersion = (Get-Content -Raw (Join-Path $Root 'VERSION')).Trim()

$gen = Join-Path $Root "build/gen/$App"
$dl = Join-Path $gen 'download'
New-Item -ItemType Directory -Force $dl | Out-Null

# ───────── 读取网站的 manifest.webmanifest（名称、图标、背景色的默认值）─────────
function Get-Text($url) {
    $c = (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30).Content
    if ($c -is [byte[]]) { $c = [Text.Encoding]::UTF8.GetString($c) }
    $c
}
$manifestCache = Join-Path $dl 'manifest.json'
$manifest = @{}
$manifestUrl = $cfg.manifest
if ($Refresh -or -not (Test-Path $manifestCache)) {
    try {
        if (-not $manifestUrl) {
            $html = Get-Text $cfg.url
            foreach ($m in [regex]::Matches($html, '<link\b[^>]*>', 'IgnoreCase')) {
                if ($m.Value -match 'rel\s*=\s*["'']?[^"''>]*\bmanifest\b' -and $m.Value -match 'href\s*=\s*["'']?([^"''\s>]+)') {
                    $manifestUrl = [Uri]::new([Uri]$cfg.url, [Net.WebUtility]::HtmlDecode($Matches[1])).AbsoluteUri
                    break
                }
            }
        }
        if ($manifestUrl) {
            $text = Get-Text $manifestUrl
            $null = $text | ConvertFrom-Json  # 校验
            Write-Utf8 $manifestCache (@{ url = $manifestUrl; body = $text } | ConvertTo-Json)
        } else {
            Write-Warning "网页里没有 <link rel=manifest>，名称/图标/背景色需要在配置里写"
            Write-Utf8 $manifestCache (@{ url = $null; body = '{}' } | ConvertTo-Json)
        }
    } catch {
        if (-not (Test-Path $manifestCache)) { throw "下载 manifest 失败：$_" }
        Write-Warning "下载 manifest 失败，使用缓存：$_"
    }
}
$cached = Read-JsonFile $manifestCache
$manifestUrl = $cached.url
$manifest = ConvertTo-Hash ($cached.body | ConvertFrom-Json)
if ($manifestUrl) { Write-Host "manifest: $manifestUrl" }

$name = First $cfg.name $manifest.short_name $manifest.name $App
$bannerText = First $cfg.bannerText $manifest.name $name

function ConvertTo-HexColor($c, $fallback) {
    if ($c -match '^#([0-9a-fA-F]{3})$') { $h = $Matches[1]; return ('#' + -join ($h.ToCharArray() | ForEach-Object { "$_$_" })).ToLower() }
    if ($c -match '^#[0-9a-fA-F]{6}$') { return $c.ToLower() }
    if ($c) { Write-Warning "颜色 $c 不是 #rgb/#rrggbb，改用 $fallback" }
    $fallback
}
$bg = ConvertTo-HexColor (First $cfg.backgroundColor $manifest.background_color) '#000000'
$iconBg = ConvertTo-HexColor ($cfg.iconBackgroundColor) $bg

# ───────── 图标：配置的 icon（URL 或相对 apps/ 的路径），否则取 manifest 里最大的 PNG ─────────
$iconFile = Join-Path $dl 'icon.img'
$maskable = $false
if ($cfg.icon) {
    if ($cfg.icon -match '^https?://') {
        if ($Refresh -or -not (Test-Path $iconFile)) { Invoke-WebRequest -UseBasicParsing -Uri $cfg.icon -OutFile $iconFile -TimeoutSec 60 }
    } else {
        Copy-Item (Join-Path $Root "apps/$($cfg.icon)") $iconFile
    }
    $maskable = [bool]$cfg.iconMaskable
} else {
    $best = $null; $bestSize = -1
    foreach ($i in @($manifest.icons)) {
        if (-not $i -or -not $i.src) { continue }
        $isPng = $i.type -eq 'image/png' -or $i.src -match '\.png(\?|$)'
        if (-not $isPng) { continue }
        $size = 0
        foreach ($s in ("$($i.sizes)" -split '\s+')) {
            if ($s -match '^(\d+)x(\d+)$') { $size = [Math]::Max($size, [int]$Matches[1]) }
        }
        if ($size -gt $bestSize) { $best = $i; $bestSize = $size }
    }
    if (-not $best) { throw "manifest 里没有 PNG 图标，请在配置里写 icon" }
    $maskable = "$($best.purpose)" -match 'maskable'
    $iconUrl = [Uri]::new([Uri]$manifestUrl, $best.src).AbsoluteUri
    if ($Refresh -or -not (Test-Path $iconFile)) {
        Write-Host "icon: $iconUrl"
        Invoke-WebRequest -UseBasicParsing -Uri $iconUrl -OutFile $iconFile -TimeoutSec 60
    }
}

# ───────── 生成资源目录（每次重建）─────────
$res = Join-Path $gen 'res'
$assets = Join-Path $gen 'assets'
foreach ($d in $res, $assets) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }
New-Item -ItemType Directory -Force $res, (Join-Path $assets 'tvshell/inject') | Out-Null

function New-Canvas([int]$w, [int]$h) {
    $bmp = [Drawing.Bitmap]::new($w, $h, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.CompositingQuality = 'HighQuality'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $bmp, $g
}
function Save-Png($bmp, $path) {
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
}
function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = [Drawing.Drawing2D.GraphicsPath]::new()
    $p.AddArc($x, $y, 2 * $r, 2 * $r, 180, 90)
    $p.AddArc($x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90)
    $p.AddArc($x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $p.AddArc($x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $p.CloseFigure()
    $p
}
function Get-Color($hex) { [Drawing.ColorTranslator]::FromHtml($hex) }

$icon = [Drawing.Image]::FromStream([IO.MemoryStream]::new([IO.File]::ReadAllBytes($iconFile)))
try {
    # 传统图标（Android 7 及以下、部分桌面）：整张图标缩放
    $densities = [ordered]@{ mdpi = 1; hdpi = 1.5; xhdpi = 2; xxhdpi = 3; xxxhdpi = 4 }
    foreach ($d in $densities.Keys) {
        $s = [int](48 * $densities[$d])
        $c, $g = New-Canvas $s $s
        $g.DrawImage($icon, 0, 0, $s, $s)
        Save-Png $c (Join-Path $res "mipmap-$d/ic_launcher.png")
        $g.Dispose(); $c.Dispose()
    }
    # 自适应图标前景（108dp，可见区 72dp）：maskable 图标的 80% 安全区对齐可见区，普通图标放进 66dp 安全区
    $fs = 432
    $c, $g = New-Canvas $fs $fs
    $is = [int]($fs * $(if ($maskable) { 90 } else { 66 }) / 108)
    $g.DrawImage($icon, [int](($fs - $is) / 2), [int](($fs - $is) / 2), $is, $is)
    Save-Png $c (Join-Path $res 'mipmap-xxxhdpi/ic_launcher_foreground.png')
    $g.Dispose(); $c.Dispose()
    New-Item -ItemType Directory -Force (Join-Path $res 'mipmap-anydpi-v26') | Out-Null
    @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/shell_icon_bg" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'@ | ForEach-Object { Write-Utf8 (Join-Path $res 'mipmap-anydpi-v26/ic_launcher.xml') $_ }

    # 电视横幅 320x180dp（xhdpi 320x180px，xxxhdpi 640x360px）：背景色 + 左侧图标 + 右侧名称
    $bgColor = Get-Color $bg
    $lum = 0.2126 * $bgColor.R + 0.7152 * $bgColor.G + 0.0722 * $bgColor.B
    $fg = if ($lum -gt 150) { [Drawing.Color]::FromArgb(255, 20, 20, 24) } else { [Drawing.Color]::White }
    foreach ($bd in @(@{ dir = 'drawable-xhdpi'; k = 1 }, @{ dir = 'drawable-xxxhdpi'; k = 2 })) {
        $k = $bd.k
        $W = 320 * $k; $H = 180 * $k
        $c, $g = New-Canvas $W $H
        $g.Clear($bgColor)
        $is = 116 * $k; $ix = 22 * $k; $iy = [int](($H - $is) / 2)
        $clip = New-RoundRect $ix $iy $is $is (22 * $k)
        $g.SetClip($clip)
        $g.DrawImage($icon, $ix, $iy, $is, $is)
        $g.ResetClip()
        $tx = $ix + $is + 16 * $k; $tw = $W - $tx - 14 * $k; $th = $H - 28 * $k
        $sf = [Drawing.StringFormat]::new()
        $sf.Alignment = 'Near'; $sf.LineAlignment = 'Center'; $sf.Trimming = 'EllipsisCharacter'
        $brush = [Drawing.SolidBrush]::new($fg)
        $font = $null
        for ($pt = 30 * $k; $pt -ge 12 * $k; $pt -= $k) {
            if ($font) { $font.Dispose() }
            $font = [Drawing.Font]::new('Microsoft YaHei UI', $pt, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
            $m = $g.MeasureString($bannerText, $font, [int]$tw, $sf)
            # 最多两行，且每个单词都放得下一行（避免单词被拆开）
            $wordsFit = @($bannerText -split '\s+' | Where-Object { $g.MeasureString($_, $font).Width -gt $tw }).Count -eq 0
            if ($wordsFit -and $m.Height -le [Math]::Min($th, $font.GetHeight($g) * 2.1)) { break }
        }
        $g.DrawString($bannerText, $font, $brush, [Drawing.RectangleF]::new($tx, 14 * $k, $tw, $th), $sf)
        Save-Png $c (Join-Path $res "$($bd.dir)/banner.png")
        $font.Dispose(); $brush.Dispose(); $sf.Dispose(); $clip.Dispose(); $g.Dispose(); $c.Dispose()
    }
} finally { $icon.Dispose() }

function ConvertTo-AndroidString($s) {
    $s = [Security.SecurityElement]::Escape($s)
    $s = $s -replace "\\", "\\" -replace "&apos;", "\'" -replace "&quot;", '\"'
    if ($s -match '^[@?]') { $s = "\$s" }
    $s
}
New-Item -ItemType Directory -Force (Join-Path $res 'values') | Out-Null
@"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">$(ConvertTo-AndroidString $name)</string>
    <color name="shell_bg">$bg</color>
    <color name="shell_icon_bg">$iconBg</color>
</resources>
"@ | ForEach-Object { Write-Utf8 (Join-Path $res 'values/generated.xml') $_ }

# ───────── 运行期配置 + 注入脚本 ─────────
$scripts = @()
foreach ($s in @($cfg.inject.scripts)) {
    if (-not $s) { continue }
    $src = Join-Path $Root "apps/$s"
    if (-not (Test-Path $src)) { throw "inject.scripts: 找不到 $src" }
    $leaf = Split-Path $s -Leaf
    Copy-Item $src (Join-Path $assets "tvshell/inject/$leaf")
    $scripts += $leaf
}
$runtime = [ordered]@{
    app             = $App
    name            = $name
    url             = $cfg.url
    appendQuery     = $cfg.appendQuery
    origins         = @($cfg.origins)
    backgroundColor = $bg
    back            = $cfg.back
    menu            = $cfg.menu
    aliases         = $cfg.aliases
    input           = $cfg.input
    keys            = $cfg.keys
    inject          = [ordered]@{
        devicePixelRatio = $cfg.inject.devicePixelRatio
        userAgent        = $cfg.inject.userAgent
        userAgentData    = $cfg.inject.userAgentData
        fixKeyEvents     = $cfg.inject.fixKeyEvents
        scripts          = $scripts
    }
    debug           = $cfg.debug
    fpsLog          = $cfg.fpsLog
}
Write-Utf8 (Join-Path $assets 'tvshell/config.json') ($runtime | ConvertTo-Json -Depth 10)
Write-Utf8 (Join-Path $gen 'build.json') ([ordered]@{
    applicationId = $cfg.applicationId
    versionCode   = [int]$cfg.versionCode
    versionName   = First $cfg.versionName $shellVersion
    orientation   = $cfg.orientation
    shellVersion  = $shellVersion
} | ConvertTo-Json)
Write-Host "app: $name ($($cfg.applicationId)) bg=$bg maskable=$maskable"

# ───────── 签名：固定的自生成 keystore（gitignore），保证以后能覆盖升级 ─────────
$ksDir = Join-Path $Root 'keystore'
$ks = Join-Path $ksDir 'tvshell.jks'
if (-not (Test-Path $ks)) {
    New-Item -ItemType Directory -Force $ksDir | Out-Null
    $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $ks -storetype PKCS12 -alias tvshell `
        -keyalg RSA -keysize 2048 -validity 36500 -storepass $pw -keypass $pw -dname 'CN=pwa-tv-shell'
    if ($LASTEXITCODE) { throw 'keytool 失败' }
    "storePassword=$pw`nkeyAlias=tvshell`nkeyPassword=$pw`n" | Set-Content -Encoding ascii (Join-Path $ksDir 'keystore.properties')
    Write-Host "已生成签名 $ks（请备份 keystore/ 目录，丢了就不能覆盖升级）"
}

# ───────── 编译 ─────────
Push-Location $Root
try {
    & (Join-Path $Root 'gradlew.bat') --console=plain -q assembleRelease "-Papp=$App"
    if ($LASTEXITCODE) { throw "Gradle 编译失败（$LASTEXITCODE）" }
} finally { Pop-Location }
New-Item -ItemType Directory -Force (Join-Path $Root 'dist') | Out-Null
$apk = Join-Path $Root "dist/$App.apk"
Copy-Item (Join-Path $Root 'app/build/outputs/apk/release/app-release.apk') $apk -Force
Write-Host ("OK  {0}  ({1:N0} KB)" -f $apk, ((Get-Item $apk).Length / 1KB))

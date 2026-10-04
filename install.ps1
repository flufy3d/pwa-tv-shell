<#
.SYNOPSIS
  用 adb 把 dist/<App>.apk 装到电视盒子（覆盖升级），可选立即启动。
.EXAMPLE
  ./install.ps1 neon-racer
  ./install.ps1 neon-racer -Run                     # 装完启动
  ./install.ps1 neon-racer -Run -NoInstall -DebugKeys -Fps -Dpr 0   # 只重启：按键叠层 + 帧率日志 + 不覆盖 dpr
  ./install.ps1 neon-racer -NoInstall -Fps -Query bench=1            # 网址临时追加参数
#>
param(
    [Parameter(Mandatory, Position = 0)][string]$App,
    [switch]$Run,         # 安装后启动（先强制停止旧进程）
    [switch]$NoInstall,   # 只启动，不安装
    [switch]$DebugKeys,   # 调试叠层：屏幕上显示原生按键和网页收到的按键事件，并开启 chrome://inspect
    [switch]$Fps,         # 每 5 秒把 rAF 帧率打到 logcat（TVShell-web）
    [double]$Dpr = -1,    # 覆盖配置里的 devicePixelRatio：0 = 不覆盖，>0 = 指定值，-1 = 用配置
    [string]$Query,       # 网址临时追加的参数，比如 bench=1
    [string]$Serial       # 设备，默认 $env:TVSHELL_DEVICE 或 100.108.156.33:5555
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
. (Join-Path $Root 'tools/env.ps1')
if ($Serial) { $Device = $Serial }

$buildJson = Join-Path $Root "build/gen/$App/build.json"
$apk = Join-Path $Root "dist/$App.apk"
if (-not (Test-Path $buildJson) -or -not (Test-Path $apk)) { throw "先运行 ./build.ps1 $App" }
$pkg = (Read-JsonFile $buildJson).applicationId

function Invoke-Adb { & $Adb -s $Device @args; if ($LASTEXITCODE) { throw "adb $args 失败（$LASTEXITCODE）" } }

# 网络设备（ip:port）掉线后自动重连
if ($Device -match ':\d+$') {
    $state = (& $Adb -s $Device get-state 2>$null)
    if ($state -ne 'device') { & $Adb disconnect $Device *> $null; & $Adb connect $Device | Out-Host }
}
if (-not $NoInstall) {
    Write-Host "install $apk -> $Device"
    Invoke-Adb install -r $apk
}
if ($Run -or $NoInstall) {
    $extra = @()
    if ($DebugKeys) { $extra += '--ez', 'debug', 'true' }
    if ($Fps) { $extra += '--ez', 'fps', 'true' }
    if ($Dpr -ge 0) { $extra += '--ef', 'dpr', "$Dpr" }
    if ($Query) { $extra += '--es', 'query', "'$Query'" } # 单引号：& 等字符会被盒子上的 shell 解释
    Invoke-Adb shell am start -S -n "$pkg/io.github.flufy3d.tvshell.ShellActivity" @extra
}

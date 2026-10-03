# build.ps1 / install.ps1 共用的环境：JDK、Android SDK、adb、盒子地址。都可以用环境变量覆盖。
$ToolsHome = if ($env:TVSHELL_TOOLS) { $env:TVSHELL_TOOLS } else { Join-Path $env:USERPROFILE 'tools' }
if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem (Join-Path $ToolsHome 'jdk-17*') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $ToolsHome 'android-sdk' }
$Adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$Device = if ($env:TVSHELL_DEVICE) { $env:TVSHELL_DEVICE } else { '100.108.156.33:5555' }

[Console]::OutputEncoding = [Text.Encoding]::UTF8

# ───────── 兼容 Windows PowerShell 5.1 的小工具 ─────────
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function ConvertTo-Hash($o) {
    if ($null -eq $o) { return $null }
    if ($o -is [System.Management.Automation.PSCustomObject]) {
        $h = [ordered]@{}
        foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = ConvertTo-Hash $p.Value }
        return $h
    }
    if ($o -is [array]) { return , @($o | ForEach-Object { ConvertTo-Hash $_ }) }
    $o
}
function Read-JsonFile($path) { ConvertTo-Hash (Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json) }
function Write-Utf8($path, [string]$text) {
    [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))
}
# 第一个非空值（5.1 没有 ?? 运算符）
function First { foreach ($a in $args) { if ($null -ne $a -and "$a" -ne '') { return $a } }; $null }

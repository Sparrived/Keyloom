[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

if (-not $config.bundle.active) {
    throw 'Tauri bundling must be enabled.'
}
if (@($config.bundle.targets).Count -ne 1 -or @($config.bundle.targets)[0] -ne 'nsis') {
    throw 'The release bundle target must be NSIS only.'
}
if ($config.bundle.windows.nsis.installMode -ne 'currentUser') {
    throw 'The default NSIS install mode must not require elevation.'
}
if ($config.bundle.windows.webviewInstallMode.type -ne 'downloadBootstrapper' -or -not $config.bundle.windows.webviewInstallMode.silent) {
    throw 'WebView2 bootstrapper detection must remain enabled and silent.'
}

$hasResources = $config.bundle.PSObject.Properties.Name -contains 'resources'
$hasInstallerHooks = $config.bundle.windows.nsis.PSObject.Properties.Name -contains 'installerHooks'
if ($hasResources -or $hasInstallerHooks) {
    throw 'Keyloom must not package or manage a private AMKR runtime.'
}

[PSCustomObject]@{
    status = 'PASS'
    install_mode = $config.bundle.windows.nsis.installMode
    webview_install_mode = $config.bundle.windows.webviewInstallMode.type
}

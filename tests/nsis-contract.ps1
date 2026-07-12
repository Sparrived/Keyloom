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

$resources = $config.bundle.resources
if ($resources.'runtime-bundle/runtime/' -ne 'runtime' -or $resources.'runtime-bundle/install-state.json' -ne 'runtime/install-state.json') {
    throw 'The private runtime bundle resource mapping is invalid.'
}

$hookPath = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $configPath) $config.bundle.windows.nsis.installerHooks))
if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) {
    throw "NSIS installer hook is missing: $hookPath"
}
$hook = Get-Content -LiteralPath $hookPath -Raw
foreach ($macro in @('NSIS_HOOK_PREINSTALL', 'NSIS_HOOK_POSTINSTALL', 'NSIS_HOOK_POSTUNINSTALL')) {
    if ($hook -notmatch [Regex]::Escape($macro)) {
        throw "NSIS hook macro is missing: $macro"
    }
}
if ($hook -notmatch [Regex]::Escape('$LOCALAPPDATA\Keyloom\install-state.json')) {
    throw 'NSIS hooks must maintain the Keyloom install state.'
}
if ($hook -match 'AutoModelKeyRouter') {
    throw 'NSIS hooks must never modify the shared AMKR config directory.'
}
if ($hook -notmatch 'FindWindow\s+\$0\s+""\s+"Keyloom"') {
    throw 'NSIS preinstall hook must reject upgrades while the Keyloom window is open.'
}

[PSCustomObject]@{
    status = 'PASS'
    installer_hook = $hookPath
    install_mode = $config.bundle.windows.nsis.installMode
    webview_install_mode = $config.bundle.windows.webviewInstallMode.type
}

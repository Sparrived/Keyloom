$ErrorActionPreference = 'Stop'

$sourcePath = Join-Path $PSScriptRoot '..\src-tauri\src\main.rs'
$source = Get-Content -Raw $sourcePath
$frontendSource = Get-Content -Raw (Join-Path $PSScriptRoot '..\src\widget-main.tsx')
$capabilitySource = Get-Content -Raw (Join-Path $PSScriptRoot '..\src-tauri\capabilities\main.json')
$required = @(
    'const AMKR_WIDGET_LABEL: &str = "amkr-widget"',
    'async fn set_amkr_widget_visible',
    'WebviewUrl::App("widget.html".into())',
    '.inner_size(360.0, 390.0)',
    '.transparent(false)',
    '.decorations(false)',
    '.always_on_top(true)',
    '.resizable(false)',
    '.skip_taskbar(true)',
    '.devtools(false)'
)

foreach ($contract in $required) {
    if (-not $source.Contains($contract)) {
        throw "AMKR widget window contract is missing: $contract"
    }
}

if (-not $frontendSource.Contains('<AmkrWidget />')) {
    throw 'AMKR widget must use its dedicated frontend entrypoint.'
}

if (-not $frontendSource.Contains('document.addEventListener("contextmenu"') -or -not $frontendSource.Contains('event.key === "F12"')) {
    throw 'AMKR widget must suppress its context menu and F12 shortcut.'
}

if (-not $capabilitySource.Contains('core:window:allow-set-size')) {
    throw 'AMKR widget must be allowed to fit its native window to its content.'
}

[pscustomobject]@{ status = 'PASS'; source = (Resolve-Path $sourcePath) }

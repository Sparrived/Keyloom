[CmdletBinding()]
param(
    [string]$Tag
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$cargo = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\Cargo.toml') -Raw
$capability = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\capabilities\main.json') -Raw

if ($cargo -notmatch '(?m)^version\s*=\s*"([^"]+)"') {
    throw 'Cargo.toml package version is missing.'
}
$cargoVersion = $Matches[1]
$versions = @([string]$package.version, [string]$tauri.version, [string]$cargoVersion)
$versions = @($versions | Sort-Object -Unique)
if ($versions.Count -ne 1) {
    throw "Release versions must match. package.json=$($package.version), tauri.conf.json=$($tauri.version), Cargo.toml=$cargoVersion."
}

$version = $versions[0]
if ($Tag -and $Tag -ne "v$version") {
    throw "Release tag must be v$version, got $Tag."
}

foreach ($dependency in @('@tauri-apps/plugin-updater', '@tauri-apps/plugin-process')) {
    if (-not $package.dependencies.$dependency) {
        throw "package.json is missing $dependency."
    }
}
foreach ($required in @('tauri-plugin-updater', 'tauri-plugin-process')) {
    if ($cargo -notmatch [Regex]::Escape($required)) {
        throw "Cargo.toml is missing $required."
    }
}
foreach ($permission in @('updater:default', 'process:allow-restart')) {
    if ($capability -notmatch [Regex]::Escape($permission)) {
        throw "main capability is missing $permission."
    }
}

$workflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github\workflows\release.yml') -Raw
if ($workflow -notmatch [Regex]::Escape('tests/release-version-contract.ps1')) {
    throw 'release workflow must run tests/release-version-contract.ps1.'
}
foreach ($required in @(
    'KEYLOOM_UPDATER_PUBLIC_KEY',
    'TAURI_SIGNING_PRIVATE_KEY',
    'Get-AuthenticodeSignature',
    'createUpdaterArtifacts',
    'latest.json',
    '*.nsis.zip.sig',
    'softprops/action-gh-release@v2',
    'generate_release_notes: true',
    'runtime-smoke.txt'
)) {
    if ($workflow -notmatch [Regex]::Escape($required)) {
        throw "release workflow is missing required updater-release behavior: $required"
    }
}

[PSCustomObject]@{
    status = 'PASS'
    version = $version
    tag = if ($Tag) { $Tag } else { $null }
}

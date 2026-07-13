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

$workflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github\workflows\release.yml') -Raw
if ($workflow -notmatch [Regex]::Escape('tests/release-version-contract.ps1')) {
    throw 'release workflow must run tests/release-version-contract.ps1.'
}

[PSCustomObject]@{
    status = 'PASS'
    version = $version
    tag = if ($Tag) { $Tag } else { $null }
}

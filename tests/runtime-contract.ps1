[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$prepareScript = Get-Content -LiteralPath (Join-Path $repoRoot 'scripts\prepare-amkr-runtime.ps1') -Raw
$releaseWorkflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github\workflows\release.yml') -Raw
$installerSmoke = Get-Content -LiteralPath (Join-Path $repoRoot 'tests\installer-smoke.ps1') -Raw

if ($prepareScript -notmatch [Regex]::Escape('$($wheel)[visitor]')) {
    throw 'prepare-amkr-runtime.ps1 must install the AMKR visitor extra.'
}
if ($releaseWorkflow -notmatch [Regex]::Escape('$($wheel)[visitor]')) {
    throw 'release workflow must download the AMKR visitor extra.'
}
if ($installerSmoke -notmatch 'itsdangerous') {
    throw 'installer smoke must verify visitor support.'
}
if ($prepareScript -notmatch [Regex]::Escape("'pip==25.0.1'")) {
    throw 'prepare-amkr-runtime.ps1 must bundle the pinned runtime updater.'
}
if ($installerSmoke -notmatch 'import auto_model_key_router, fastapi, httpx, itsdangerous, pip,') {
    throw 'installer smoke must verify the bundled runtime updater.'
}

[PSCustomObject]@{
    status = 'PASS'
}

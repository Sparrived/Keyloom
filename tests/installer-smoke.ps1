[CmdletBinding()]
param(
    [string]$RuntimeDirectory,
    [string]$InstallStatePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $env:LOCALAPPDATA -and (-not $RuntimeDirectory -or -not $InstallStatePath)) {
    throw 'LOCALAPPDATA is required when runtime paths are not provided.'
}
if (-not $RuntimeDirectory) {
    $RuntimeDirectory = Join-Path $env:LOCALAPPDATA 'Programs\Keyloom\runtime'
}
if (-not $InstallStatePath) {
    $InstallStatePath = Join-Path $env:LOCALAPPDATA 'Keyloom\install-state.json'
}

$runtime = [IO.Path]::GetFullPath($RuntimeDirectory)
$statePath = [IO.Path]::GetFullPath($InstallStatePath)
$repoRoot = Split-Path -Parent $PSScriptRoot
$contractScript = Join-Path $repoRoot 'scripts\verify-amkr-contract.py'
$python = Join-Path $runtime 'python.exe'
$pythonw = Join-Path $runtime 'pythonw.exe'
$module = Join-Path $runtime 'Lib\site-packages\auto_model_key_router\__init__.py'

foreach ($requiredFile in @($python, $pythonw, $module, $statePath, $contractScript)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required runtime file is missing: $requiredFile"
    }
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$expectedFields = @('schema_version', 'owner', 'python_version', 'amkr_version', 'amkr_wheel_sha256')
$actualFields = @($state.PSObject.Properties.Name)
$unexpected = @($actualFields | Where-Object { $_ -notin $expectedFields })
$missing = @($expectedFields | Where-Object { $_ -notin $actualFields })
if ($unexpected.Count -gt 0 -or $missing.Count -gt 0) {
    throw "Install state schema mismatch. Missing: $($missing -join ', '); unexpected: $($unexpected -join ', ')."
}
if ($state.schema_version -ne 1 -or $state.owner -ne 'com.keyloom.app') {
    throw 'Install state owner or schema version is invalid.'
}
if ([string]$state.amkr_wheel_sha256 -cnotmatch '^[0-9a-f]{64}$') {
    throw 'Install state AMKR wheel SHA-256 is invalid.'
}

$smokeOutput = & $python -I -c 'import auto_model_key_router, fastapi, httpx, itsdangerous, pip, uvicorn, json, platform, pathlib, sys; print(json.dumps(dict(python_version=platform.python_version(), amkr_version=auto_model_key_router.__version__, executable=str(pathlib.Path(sys.executable).resolve()))))'
if ($LASTEXITCODE -ne 0 -or -not $smokeOutput) {
    throw 'Private runtime import smoke test failed.'
}
$smokeJson = ([string]$smokeOutput).Trim()
$smoke = $smokeJson | ConvertFrom-Json
if ($smoke.python_version -ne $state.python_version) {
    throw "Python version mismatch: state=$($state.python_version), runtime=$($smoke.python_version)."
}
if ($smoke.amkr_version -ne $state.amkr_version) {
    throw "AMKR version mismatch: state=$($state.amkr_version), runtime=$($smoke.amkr_version)."
}
if ([IO.Path]::GetFullPath($smoke.executable) -ne [IO.Path]::GetFullPath($python)) {
    throw "Smoke test used an unexpected Python executable: $($smoke.executable)."
}

& $python -I $contractScript
if ($LASTEXITCODE -ne 0) {
    throw 'Private runtime AMKR management API contract failed.'
}

[PSCustomObject]@{
    status = 'PASS'
    runtime_directory = $runtime
    python_version = [string]$smoke.python_version
    amkr_version = [string]$smoke.amkr_version
    amkr_wheel_sha256 = [string]$state.amkr_wheel_sha256
}

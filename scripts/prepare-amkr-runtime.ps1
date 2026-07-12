[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PythonEmbedArchive,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$PythonArchiveSha256,

    [Parameter(Mandatory = $true)]
    [string]$AmkrWheel,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$AmkrWheelSha256,

    [Parameter(Mandatory = $true)]
    [string]$WheelhouseDirectory,

    [Parameter(Mandatory = $true)]
    [string]$RuntimeOutputDirectory,

    [string]$InstallStateOutputPath,

    [string]$BuildPython = 'python'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ExistingPath {
    param([string]$Path, [string]$Label, [string]$PathType)

    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if ($PathType -eq 'Leaf' -and -not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "$Label must be a file: $Path"
    }
    if ($PathType -eq 'Container' -and -not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
        throw "$Label must be a directory: $Path"
    }
    return [IO.Path]::GetFullPath($resolved.Path)
}

function Resolve-OutputPath {
    param([string]$Path)

    return [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path))
}

function Assert-ChildPath {
    param([string]$Path, [string]$Parent)

    $parentPrefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside its expected parent: $fullPath"
    }
}

function Assert-Sha256 {
    param([string]$Path, [string]$Expected, [string]$Label)

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) {
        throw "$Label SHA-256 mismatch. Expected $Expected, got $actual."
    }
    return $actual
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments, [string]$Label)

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

$archive = Resolve-ExistingPath $PythonEmbedArchive 'Python embed archive' 'Leaf'
$wheel = Resolve-ExistingPath $AmkrWheel 'AMKR wheel' 'Leaf'
$wheelhouse = Resolve-ExistingPath $WheelhouseDirectory 'Wheelhouse' 'Container'
$runtimeOutput = Resolve-OutputPath $RuntimeOutputDirectory
$runtimeParent = Split-Path -Parent $runtimeOutput
if (-not $runtimeParent -or $runtimeOutput.TrimEnd('\', '/') -eq [IO.Path]::GetPathRoot($runtimeOutput).TrimEnd('\', '/')) {
    throw 'RuntimeOutputDirectory cannot be a filesystem root.'
}
if (-not $InstallStateOutputPath) {
    $InstallStateOutputPath = Join-Path $runtimeParent 'install-state.json'
}
$stateOutput = Resolve-OutputPath $InstallStateOutputPath
$stateParent = Split-Path -Parent $stateOutput

$pythonArchiveHash = Assert-Sha256 $archive $PythonArchiveSha256 'Python archive'
$amkrWheelHash = Assert-Sha256 $wheel $AmkrWheelSha256 'AMKR wheel'

New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
New-Item -ItemType Directory -Path $stateParent -Force | Out-Null
$staging = Join-Path $runtimeParent ('.runtime-staging-' + [Guid]::NewGuid().ToString('N'))
$buildEnvironment = Join-Path $runtimeParent ('.build-python-' + [Guid]::NewGuid().ToString('N'))
$stateStaging = Join-Path $stateParent ('.install-state-' + [Guid]::NewGuid().ToString('N') + '.json')
$runtimeBackup = "$runtimeOutput.previous"
$stateBackup = "$stateOutput.previous"
Assert-ChildPath $staging $runtimeParent
Assert-ChildPath $buildEnvironment $runtimeParent
Assert-ChildPath $runtimeBackup $runtimeParent
Assert-ChildPath $stateStaging $stateParent
Assert-ChildPath $stateBackup $stateParent

try {
    Expand-Archive -LiteralPath $archive -DestinationPath $staging

    $python = Join-Path $staging 'python.exe'
    $pythonw = Join-Path $staging 'pythonw.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf) -or -not (Test-Path -LiteralPath $pythonw -PathType Leaf)) {
        throw 'Embedded Python archive must contain python.exe and pythonw.exe at its root.'
    }

    $pthFiles = @(Get-ChildItem -LiteralPath $staging -Filter 'python*._pth' -File)
    if ($pthFiles.Count -ne 1) {
        throw "Expected exactly one python*._pth file, found $($pthFiles.Count)."
    }
    $pthLines = [Collections.Generic.List[string]]::new()
    $hasSitePackages = $false
    $hasImportSite = $false
    foreach ($line in [IO.File]::ReadAllLines($pthFiles[0].FullName)) {
        $trimmed = $line.Trim()
        if ($trimmed -eq 'Lib\site-packages') {
            $hasSitePackages = $true
        }
        if ($trimmed -eq '#import site' -or $trimmed -eq 'import site') {
            if (-not $hasImportSite) {
                $pthLines.Add('import site')
                $hasImportSite = $true
            }
        } else {
            $pthLines.Add($line)
        }
    }
    if (-not $hasSitePackages) {
        $pthLines.Insert([Math]::Max(0, $pthLines.Count - [int]$hasImportSite), 'Lib\site-packages')
    }
    if (-not $hasImportSite) {
        $pthLines.Add('import site')
    }
    [IO.File]::WriteAllLines($pthFiles[0].FullName, $pthLines, [Text.UTF8Encoding]::new($false))

    $sitePackages = Join-Path $staging 'Lib\site-packages'
    New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null

    Invoke-Checked $BuildPython @('-m', 'venv', $buildEnvironment) 'Isolated build environment creation'
    $isolatedBuildPython = Join-Path $buildEnvironment 'Scripts\python.exe'
    $buildVersionOutput = & $isolatedBuildPython -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sep=chr(46))'
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read the build Python version.'
    }
    $buildVersion = ([string]$buildVersionOutput).Trim()
    $embeddedVersionOutput = & $python -I -c 'import platform; print(platform.python_version())'
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to run the embedded Python interpreter.'
    }
    $embeddedVersion = ([string]$embeddedVersionOutput).Trim()
    if (-not $embeddedVersion.StartsWith("$buildVersion.")) {
        throw "Build Python $buildVersion does not match embedded Python $embeddedVersion."
    }

    Invoke-Checked $isolatedBuildPython @(
        '-m', 'pip', 'install',
        '--disable-pip-version-check', '--no-input', '--no-compile',
        '--ignore-installed',
        '--no-index', '--find-links', $wheelhouse,
        '--target', $sitePackages,
        $wheel
    ) 'Offline AMKR installation'

    $smokeOutput = & $python -I -c 'import auto_model_key_router, fastapi, httpx, uvicorn, json, platform; print(json.dumps(dict(python_version=platform.python_version(), amkr_version=auto_model_key_router.__version__)))'
    if ($LASTEXITCODE -ne 0 -or -not $smokeOutput) {
        throw 'The prepared runtime could not import AMKR and its core dependencies.'
    }
    $smokeJson = ([string]$smokeOutput).Trim()
    $smoke = $smokeJson | ConvertFrom-Json
    if ($smoke.python_version -ne $embeddedVersion -or -not $smoke.amkr_version) {
        throw 'The prepared runtime returned inconsistent version metadata.'
    }

    $state = [ordered]@{
        schema_version = 1
        owner = 'com.keyloom.app'
        python_version = [string]$smoke.python_version
        amkr_version = [string]$smoke.amkr_version
        amkr_wheel_sha256 = $amkrWheelHash
    }
    [IO.File]::WriteAllText(
        $stateStaging,
        (($state | ConvertTo-Json -Depth 3) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )

    if (Test-Path -LiteralPath $runtimeBackup) {
        Remove-Item -LiteralPath $runtimeBackup -Recurse -Force
    }
    if (Test-Path -LiteralPath $stateBackup) {
        Remove-Item -LiteralPath $stateBackup -Force
    }
    if (Test-Path -LiteralPath $runtimeOutput) {
        Move-Item -LiteralPath $runtimeOutput -Destination $runtimeBackup
    }
    if (Test-Path -LiteralPath $stateOutput) {
        Move-Item -LiteralPath $stateOutput -Destination $stateBackup
    }

    try {
        Move-Item -LiteralPath $staging -Destination $runtimeOutput
        Move-Item -LiteralPath $stateStaging -Destination $stateOutput
    } catch {
        if (Test-Path -LiteralPath $runtimeOutput) {
            Remove-Item -LiteralPath $runtimeOutput -Recurse -Force
        }
        if (Test-Path -LiteralPath $stateOutput) {
            Remove-Item -LiteralPath $stateOutput -Force
        }
        if (Test-Path -LiteralPath $runtimeBackup) {
            Move-Item -LiteralPath $runtimeBackup -Destination $runtimeOutput
        }
        if (Test-Path -LiteralPath $stateBackup) {
            Move-Item -LiteralPath $stateBackup -Destination $stateOutput
        }
        throw
    }

    [PSCustomObject]@{
        runtime_directory = $runtimeOutput
        install_state = $stateOutput
        python_archive_sha256 = $pythonArchiveHash
        amkr_wheel_sha256 = $amkrWheelHash
        python_version = [string]$smoke.python_version
        amkr_version = [string]$smoke.amkr_version
    }
} finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    if (Test-Path -LiteralPath $stateStaging) {
        Remove-Item -LiteralPath $stateStaging -Force
    }
    if (Test-Path -LiteralPath $buildEnvironment) {
        Remove-Item -LiteralPath $buildEnvironment -Recurse -Force
    }
}

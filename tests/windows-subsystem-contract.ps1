[CmdletBinding()]
param(
    [string]$SourcePath = 'src-tauri/src/main.rs',
    [string]$ExecutablePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$source = Get-Content -LiteralPath $SourcePath -Raw
if ($source -notmatch '#!\[cfg_attr\(not\(debug_assertions\),\s*windows_subsystem\s*=\s*"windows"\)\]') {
    throw 'Release builds must use the Windows GUI subsystem.'
}

$subsystem = $null
if ($ExecutablePath) {
    $stream = [IO.File]::OpenRead((Resolve-Path -LiteralPath $ExecutablePath))
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Executable is missing the MZ header.' }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Executable is missing the PE header.' }
        $optionalHeader = $peOffset + 24
        $stream.Position = $optionalHeader
        $magic = $reader.ReadUInt16()
        if ($magic -notin @(0x10B, 0x20B)) { throw "Unsupported PE optional header: $magic" }
        $stream.Position = $optionalHeader + 68
        $subsystem = $reader.ReadUInt16()
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
    if ($subsystem -ne 2) {
        throw "Release executable must use Windows GUI subsystem 2, found $subsystem."
    }
}

[PSCustomObject]@{
    status = 'PASS'
    source = [IO.Path]::GetFullPath($SourcePath)
    executable = if ($ExecutablePath) { [IO.Path]::GetFullPath($ExecutablePath) } else { $null }
    subsystem = $subsystem
}

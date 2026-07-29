param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$IncludePrimaryTauriTarget
)

$ErrorActionPreference = 'Stop'

# Deliberately preserved:
# - release/desktop (installers and the unpacked portable edition)
# - backend/data and %LOCALAPPDATA%\英语阅读工具\data (application data)
# - backend/.venv and frontend/node_modules (development dependencies)
$paths = @(
    'build\pyinstaller',
    'build\tauri-sidecar\work',
    'frontend\dist'
)

if ($IncludePrimaryTauriTarget) {
    $paths += 'src-tauri\target'
}

foreach ($relativePath in $paths) {
    $path = Join-Path $ProjectRoot $relativePath
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
        Write-Host "已删除：$relativePath"
    }
}
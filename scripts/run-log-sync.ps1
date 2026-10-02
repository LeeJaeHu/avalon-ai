param([switch]$Once)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $projectPath '.log-sync'
$runtime = Get-Content -LiteralPath (Join-Path $settingsPath 'runtime.json') -Raw | ConvertFrom-Json
$secure = (Get-Content -LiteralPath (Join-Path $settingsPath 'credentials.dpapi') -Raw).Trim() | ConvertTo-SecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:AVALON_LOG_SYNC_CONFIG = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $arguments = @((Join-Path $PSScriptRoot 'sync-game-logs.mjs'))
    if ($Once) { $arguments += '--once' }
    & $runtime.node @arguments
    exit $LASTEXITCODE
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Item Env:AVALON_LOG_SYNC_CONFIG -ErrorAction SilentlyContinue
}

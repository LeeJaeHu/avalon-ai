$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $projectPath '.log-sync'
New-Item -ItemType Directory -Path $settingsPath -Force | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $settingsPath /inheritance:r /grant:r "$($identity):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '인증 폴더 권한 설정 실패' }
$secure = Read-Host -AsSecureString 'Log sync configuration'
$secure | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $settingsPath 'credentials.dpapi') -Encoding UTF8
@{ node = (Get-Command node -ErrorAction Stop).Source } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $settingsPath 'runtime.json') -Encoding UTF8
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$runner = Join-Path $PSScriptRoot 'run-log-sync.ps1'
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'AvalonLogSync' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Avalon 종료·중단 게임 로그를 $projectPath\logs 에 동기화합니다." -Force | Out-Null
Write-Output '동기화 인증 보호와 로그인 자동 실행 등록 완료'

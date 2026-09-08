# Docker Windows Optimization Script
# Optimizes Docker Desktop for Windows performance
# Usage: .\docker-windows-optimization.ps1

Write-Host "Optimizing Docker for Windows Performance..." -ForegroundColor Cyan

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "This script requires Administrator privileges. Please run as Administrator." -ForegroundColor Yellow
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# 1. Optimize WSL2 memory
Write-Host "`nConfiguring WSL2 memory settings..." -ForegroundColor Yellow
$wslConfigPath = "$env:USERPROFILE\.wslconfig"
$wslConfigContent = @"
[wsl2]
memory=8GB
processors=4
swap=2GB
localhostForwarding=true
"@

if (-not (Test-Path $wslConfigPath)) {
    Set-Content -Path $wslConfigPath -Value $wslConfigContent
    Write-Host "Created .wslconfig with optimized settings" -ForegroundColor Green
} else {
    Write-Host ".wslconfig already exists. Please review manually." -ForegroundColor Cyan
}

# 2. Optimize Windows performance
Write-Host "`nOptimizing Windows performance for Docker..." -ForegroundColor Yellow

# Disable Windows Game DVR (can interfere with Docker)
try {
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\GameBar" -Name "AllowAutoGameMode" -Value 0 -ErrorAction SilentlyContinue
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\GameBar" -Name "AutoGameModeEnabled" -Value 0 -ErrorAction SilentlyContinue
    Write-Host "Disabled Windows Game DVR" -ForegroundColor Green
} catch {
    Write-Host "Could not disable Game DVR (may not be available)" -ForegroundColor Yellow
}

# 3. Configure Docker Desktop resources
Write-Host "`nDocker Desktop Resource Configuration Recommendations:" -ForegroundColor Yellow
Write-Host "Please manually configure these settings in Docker Desktop:" -ForegroundColor Cyan
Write-Host "1. Open Docker Desktop -> Settings -> Resources" -ForegroundColor White
Write-Host "2. WSL Integration: Enable WSL 2" -ForegroundColor White
Write-Host "3. Memory: 8GB (or more if available)" -ForegroundColor White
Write-Host "4. CPUs: 4 (or more if available)" -ForegroundColor White
Write-Host "5. Disk: At least 50GB" -ForegroundColor White
Write-Host "6. File sharing: Enable E:\discord-aibot-monorepo" -ForegroundColor White

# 4. Network optimization
Write-Host "`nNetwork Optimization:" -ForegroundColor Yellow
Write-Host "Configure Docker Desktop -> Settings -> Resources -> Network:" -ForegroundColor Cyan
Write-Host "1. DNS Server: Use fixed DNS (8.8.8.8, 8.8.4.4)" -ForegroundColor White
Write-Host "2. Enable IPv6 if needed" -ForegroundColor White

# 5. Create daemon.json for Docker optimizations
Write-Host "`nConfiguring Docker daemon optimizations..." -ForegroundColor Yellow
$daemonConfigPath = "$env:USERPROFILE\.docker\daemon.json"
$daemonConfig = @{
    "log-driver" = "json-file"
    "log-opts" = @{
        "max-size" = "10m"
        "max-file" = "3"
    }
    "metrics-addr" = "127.0.0.1:9323"
    "experimental" = $false
    "registry-mirrors" = @(
        "https://mirror.gcr.io"
    )
}

if (-not (Test-Path $daemonConfigPath)) {
    $daemonConfig | ConvertTo-Json -Depth 3 | Set-Content -Path $daemonConfigPath
    Write-Host "Created daemon.json with optimized settings" -ForegroundColor Green
} else {
    Write-Host "daemon.json already exists. Please review manually." -ForegroundColor Cyan
}

# 6. Restart WSL to apply changes
Write-Host "`nTo apply WSL2 changes, restart WSL:" -ForegroundColor Yellow
Write-Host "Run: wsl --shutdown" -ForegroundColor Cyan
Write-Host "Then restart Docker Desktop" -ForegroundColor Cyan

Write-Host "`nDocker Windows optimization completed!" -ForegroundColor Green
Write-Host "Please restart Docker Desktop and WSL for all changes to take effect." -ForegroundColor Yellow
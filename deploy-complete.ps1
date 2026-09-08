# Complete Deployment Workflow Script
# End-to-end deployment automation for Discord bots
# Usage: .\deploy-complete.ps1

param(
    [switch]$SkipBuild,
    [switch]$LocalDeploy,
    [switch]$IncludeMonitoring
)

Write-Host "Starting Complete Discord Bot Deployment..." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green

# 1. Environment Setup
Write-Host "`nStep 1: Environment Setup" -ForegroundColor Cyan
if (-not (Test-Path .env)) {
    Write-Host "Creating .env file from template..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "Please edit .env with your actual values" -ForegroundColor Yellow
    Write-Host "Press Enter to continue after editing .env file..."
    $null = Read-Host
}

# 2. Build Images
if (-not $SkipBuild) {
    Write-Host "`nStep 2: Building Docker Images" -ForegroundColor Cyan
    & "$PSScriptRoot\docker-build.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed. Exiting..." -ForegroundColor Red
        exit 1
    }
}

# 3. Start Infrastructure Services
Write-Host "`nStep 3: Starting Infrastructure Services" -ForegroundColor Cyan
Write-Host "Starting PostgreSQL, Redis, and MongoDB..." -ForegroundColor Yellow
docker-compose up -d postgres redis mongo

Write-Host "Waiting for databases to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# 4. Deploy Bot Services
Write-Host "`nStep 4: Deploying Bot Services" -ForegroundColor Cyan
$botServices = @("soundproof", "listen", "airhornbot", "discord-aibot", "lastfm")
foreach ($bot in $botServices) {
    Write-Host "Deploying $bot..." -ForegroundColor Yellow
    docker-compose up -d $bot
    Start-Sleep -Seconds 5
}

# 5. Start Monitoring (if requested)
if ($IncludeMonitoring) {
    Write-Host "`nStep 5: Starting Monitoring Services" -ForegroundColor Cyan
    docker-compose up -d prometheus grafana
    Write-Host "Grafana available at: http://localhost:3000" -ForegroundColor Green
    Write-Host "Prometheus available at: http://localhost:9090" -ForegroundColor Green
}

# 6. Health Check
Write-Host "`nStep 6: Health Check" -ForegroundColor Cyan
Start-Sleep -Seconds 10
Write-Host "Service Status:" -ForegroundColor Yellow
docker-compose ps

# 7. Display Information
Write-Host "`nDeployment Completed Successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host "Available Services:" -ForegroundColor Cyan
Write-Host "  • Soundproof Bot: http://localhost:3001" -ForegroundColor White
Write-Host "  • Listen Bot: http://localhost:3002" -ForegroundColor White
Write-Host "  • Airhornbot: http://localhost:3003" -ForegroundColor White
Write-Host "  • Discord AI Bot: http://localhost:3004" -ForegroundColor White
Write-Host "  • Last.fm Bot: http://localhost:3005" -ForegroundColor White
Write-Host "  • PostgreSQL: localhost:5432" -ForegroundColor White
Write-Host "  • Redis: localhost:6379" -ForegroundColor White
Write-Host "  • MongoDB: localhost:27017" -ForegroundColor White

if ($IncludeMonitoring) {
    Write-Host "  • Grafana: http://localhost:3000" -ForegroundColor White
    Write-Host "  • Prometheus: http://localhost:9090" -ForegroundColor White
}

Write-Host "`nUseful Commands:" -ForegroundColor Cyan
Write-Host "  • View logs: .\docker-logs.ps1" -ForegroundColor White
Write-Host "  • Check status: .\docker-status.ps1" -ForegroundColor White
Write-Host "  • Stop services: .\docker-stop.ps1" -ForegroundColor White
Write-Host "  • Restart services: .\docker-restart.ps1" -ForegroundColor White

Write-Host "`nReady to use! Your Discord bots are now running." -ForegroundColor Green
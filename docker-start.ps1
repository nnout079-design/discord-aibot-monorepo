# Docker Start Script - Start all Discord bot services
# Usage: .\docker-start.ps1

Write-Host "Starting Discord Bot Services..." -ForegroundColor Green

# Check if .env file exists
if (-not (Test-Path .env)) {
    Write-Host "WARNING: .env file not found. Creating from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "Please edit .env file with your actual values before starting services." -ForegroundColor Yellow
    exit 1
}

# Start all services
docker-compose up -d

# Wait for services to be healthy
Write-Host "Waiting for services to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check service status
Write-Host "Service Status:" -ForegroundColor Cyan
docker-compose ps

Write-Host "All services started successfully!" -ForegroundColor Green
Write-Host "Monitoring: http://localhost:3000 (Grafana)" -ForegroundColor Cyan
Write-Host "Metrics: http://localhost:9090 (Prometheus)" -ForegroundColor Cyan
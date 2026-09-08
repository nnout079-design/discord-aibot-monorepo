# Docker Restart Script - Restart all Discord bot services
# Usage: .\docker-restart.ps1

Write-Host "Restarting Discord Bot Services..." -ForegroundColor Cyan

# Restart all services
docker-compose restart

# Wait for services to be healthy
Write-Host "Waiting for services to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check service status
Write-Host "Service Status:" -ForegroundColor Cyan
docker-compose ps

Write-Host "All services restarted successfully!" -ForegroundColor Green
# Docker Stop Script - Stop all Discord bot services
# Usage: .\docker-stop.ps1

Write-Host "Stopping Discord Bot Services..." -ForegroundColor Yellow

# Stop all services
docker-compose down

Write-Host "All services stopped successfully!" -ForegroundColor Green
# Docker Clean Script - Clean up Docker resources
# Usage: .\docker-clean.ps1

Write-Host "Cleaning up Docker resources..." -ForegroundColor Yellow

# Stop and remove containers
Write-Host "Stopping and removing containers..." -ForegroundColor Cyan
docker-compose down -v

# Remove unused images
Write-Host "Removing unused images..." -ForegroundColor Cyan
docker image prune -f

# Remove unused volumes
Write-Host "Removing unused volumes..." -ForegroundColor Cyan
docker volume prune -f

# Remove unused networks
Write-Host "Removing unused networks..." -ForegroundColor Cyan
docker network prune -f

Write-Host "Cleanup completed successfully!" -ForegroundColor Green
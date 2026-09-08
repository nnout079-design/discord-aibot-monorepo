# Docker Status Script - Check status of all Discord bot services
# Usage: .\docker-status.ps1

Write-Host "Discord Bot Services Status" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Check Docker service
Write-Host "`nDocker Status:" -ForegroundColor Yellow
docker info --format "Docker Version: {{.ServerVersion}}" | ForEach-Object { Write-Host $_ }

# Container status
Write-Host "`nContainer Status:" -ForegroundColor Yellow
docker-compose ps

# Resource usage
Write-Host "`nResource Usage:" -ForegroundColor Yellow
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Network status
Write-Host "`nNetwork Status:" -ForegroundColor Yellow
docker network ls | Select-String discord

# Volume status
Write-Host "`nVolume Status:" -ForegroundColor Yellow
docker volume ls | Select-String discord
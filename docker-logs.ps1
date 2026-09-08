# Docker Logs Script - View logs from Discord bot services
# Usage: .\docker-logs.ps1 [service_name]
# Example: .\docker-logs.ps1 soundproof

param(
    [string]$Service = ""
)

if ($Service) {
    Write-Host "Showing logs for $Service..." -ForegroundColor Cyan
    docker-compose logs -f --tail=50 $Service
} else {
    Write-Host "Showing logs for all services..." -ForegroundColor Cyan
    docker-compose logs -f --tail=50
}
# Docker Build Script - Build all Discord bot images
# Usage: .\docker-build.ps1 [service_name]
# Example: .\docker-build.ps1 soundproof

param(
    [string]$Service = ""
)

Write-Host "Building Docker images..." -ForegroundColor Cyan

if ($Service) {
    Write-Host "Building $Service..." -ForegroundColor Yellow
    docker-compose build $Service
} else {
    Write-Host "Building all services..." -ForegroundColor Yellow
    docker-compose build
}

Write-Host "Build completed successfully!" -ForegroundColor Green
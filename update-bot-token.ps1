#!/usr/bin/env pwsh
# update-bot-token.ps1
# Updates the Discord token for all bots and restarts them

param(
    [Parameter(Mandatory=$true)]
    [string]$DiscordToken
)

cd E:\discord-aibot-monorepo

Write-Host "🔐 Setting Discord token for all bots..." -ForegroundColor Cyan

# Read current .env
$envContent = Get-Content .env -Raw

# Replace or add DISCORD_TOKEN
if ($envContent -match "DISCORD_TOKEN=") {
    $envContent = $envContent -replace "DISCORD_TOKEN=.*", "DISCORD_TOKEN=$DiscordToken"
} else {
    $envContent += "`nDISCORD_TOKEN=$DiscordToken"
}

# Write back
Set-Content -Path .env -Value $envContent
Write-Host "✅ .env updated with Discord token" -ForegroundColor Green

# Recreate all bots with new environment variables
Write-Host "🔄 Recreating bot containers with updated token..." -ForegroundColor Cyan
docker compose -f docker-compose.yml up -d lastfm listen airhornbot discord-aibot

# Wait and show status
Write-Host "⏳ Waiting for bots to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "📊 Bot Status:" -ForegroundColor Cyan
docker compose -f docker-compose.yml ps

# Check logs
Write-Host "`n📋 Recent logs (lastfm-bot):" -ForegroundColor Cyan
docker logs lastfm-bot -n 5

Write-Host "`n✅ Done! Bots have been recreated with new token." -ForegroundColor Green

# Discord Bot Roadmap Deployment Script
# Automated deployment based on the roadmap phases
# Usage: .\deploy-roadmap.ps1 -Phase <phase_number>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet(1, 2, 3, 4, 5)]
    [int]$Phase,
    
    [switch]$LocalDeploy,
    
    [switch]$SkipBuild
)

$botNames = @("soundproof", "listen", "airhornbot", "discord-aibot", "lastfm")

Write-Host "Starting Roadmap Phase $Phase Deployment..." -ForegroundColor Green

switch ($Phase) {
    1 {
        Write-Host "Phase 1: Enhance Bot Logic" -ForegroundColor Cyan
        Write-Host "Adding slash commands and bot-specific features..." -ForegroundColor Yellow
        
        foreach ($bot in $botNames) {
            Write-Host "`nDeploying $bot with Phase 1 features..." -ForegroundColor Yellow
            & "$PSScriptRoot\deploy-bot.ps1" -BotName $bot -Features @("slash-commands", "bot-specific") -SkipBuild:$SkipBuild -LocalDeploy:$LocalDeploy
        }
        
        Write-Host "`nPhase 1 deployment completed!" -ForegroundColor Green
        Write-Host "Next steps: Test slash commands locally with docker-compose" -ForegroundColor Cyan
    }
    
    2 {
        Write-Host "Phase 2: Data Persistence" -ForegroundColor Cyan
        Write-Host "Setting up PostgreSQL and Redis integration..." -ForegroundColor Yellow
        
        foreach ($bot in $botNames) {
            Write-Host "`nDeploying $bot with Phase 2 features..." -ForegroundColor Yellow
            & "$PSScriptRoot\deploy-bot.ps1" -BotName $bot -Features @("database", "redis") -SkipBuild:$SkipBuild -LocalDeploy:$LocalDeploy
        }
        
        Write-Host "`nPhase 2 deployment completed!" -ForegroundColor Green
        Write-Host "Next steps: Set DATABASE_URL and REDIS_URL environment variables" -ForegroundColor Cyan
    }
    
    3 {
        Write-Host "Phase 3: Advanced Reasoning" -ForegroundColor Cyan
        Write-Host "Expanding reasoning engines and Claude API integration..." -ForegroundColor Yellow
        
        foreach ($bot in $botNames) {
            Write-Host "`nDeploying $bot with Phase 3 features..." -ForegroundColor Yellow
            & "$PSScriptRoot\deploy-bot.ps1" -BotName $bot -Features @("claude-api", "bot-specific") -SkipBuild:$SkipBuild -LocalDeploy:$LocalDeploy
        }
        
        Write-Host "`nPhase 3 deployment completed!" -ForegroundColor Green
        Write-Host "Next steps: Set CLAUDE_API_KEY environment variable" -ForegroundColor Cyan
    }
    
    4 {
        Write-Host "Phase 4: Monitoring & Analytics" -ForegroundColor Cyan
        Write-Host "Setting up Prometheus and Grafana..." -ForegroundColor Yellow
        
        foreach ($bot in $botNames) {
            Write-Host "`nDeploying $bot with Phase 4 features..." -ForegroundColor Yellow
            & "$PSScriptRoot\deploy-bot.ps1" -BotName $bot -Features @("monitoring") -SkipBuild:$SkipBuild -LocalDeploy:$LocalDeploy
        }
        
        Write-Host "`nPhase 4 deployment completed!" -ForegroundColor Green
        Write-Host "Next steps: Access Grafana at http://localhost:3000" -ForegroundColor Cyan
    }
    
    5 {
        Write-Host "Phase 5: Advanced Features" -ForegroundColor Cyan
        Write-Host "Adding user profiles, multi-guild support, and ML features..." -ForegroundColor Yellow
        
        foreach ($bot in $botNames) {
            Write-Host "`nDeploying $bot with Phase 5 features..." -ForegroundColor Yellow
            & "$PSScriptRoot\deploy-bot.ps1" -BotName $bot -Features @("bot-specific", "database", "redis") -SkipBuild:$SkipBuild -LocalDeploy:$LocalDeploy
        }
        
        Write-Host "`nPhase 5 deployment completed!" -ForegroundColor Green
        Write-Host "Next steps: Implement advanced features per bot" -ForegroundColor Cyan
    }
}

Write-Host "`nRoadmap Phase $Phase deployment completed successfully!" -ForegroundColor Green
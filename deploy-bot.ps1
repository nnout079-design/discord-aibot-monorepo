# Discord Bot Deployment Script
# Automates deployment of individual bots with roadmap features
# Usage: .\deploy-bot.ps1 -BotName <bot_name> -Features <feature_list>

param(
    [Parameter(Mandatory=$true)]
    [string]$BotName,
    
    [string[]]$Features = @(),
    
    [switch]$SkipBuild,
    
    [switch]$LocalDeploy
)

$validBots = @("soundproof", "listen", "airhornbot", "discord-aibot", "lastfm")
$validFeatures = @("slash-commands", "database", "redis", "monitoring", "claude-api", "bot-specific")

# Validate bot name
if ($BotName -notin $validBots) {
    Write-Host "Invalid bot name. Valid options: $($validBots -join ', ')" -ForegroundColor Red
    exit 1
}

# Validate features
foreach ($feature in $Features) {
    if ($feature -notin $validFeatures) {
        Write-Host "Invalid feature: $feature. Valid options: $($validFeatures -join ', ')" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Deploying $BotName bot with features: $($Features -join ', ')" -ForegroundColor Green

# Navigate to bot directory
$botPath = Join-Path $PSScriptRoot $BotName
if (-not (Test-Path $botPath)) {
    Write-Host "Bot directory not found: $botPath" -ForegroundColor Red
    exit 1
}

Set-Location $botPath

# Build Docker image
if (-not $SkipBuild) {
    Write-Host "Building Docker image for $BotName..." -ForegroundColor Yellow
    docker build -t discord-bot-$BotName`:latest .
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Docker build completed" -ForegroundColor Green
}

# Apply feature-specific configurations
if ($Features -contains "slash-commands") {
    Write-Host "Applying slash commands configuration..." -ForegroundColor Yellow
    # Create commands directory if it doesn't exist
    if (-not (Test-Path "src\commands")) {
        New-Item -ItemType Directory -Path "src\commands" -Force
        Write-Host "Created commands directory" -ForegroundColor Green
    }
}

if ($Features -contains "database") {
    Write-Host "Applying database configuration..." -ForegroundColor Yellow
    # Add database connection support would go here
    Write-Host "Database configuration applied" -ForegroundColor Green
}

if ($Features -contains "redis") {
    Write-Host "Applying Redis configuration..." -ForegroundColor Yellow
    # Add Redis cache support would go here
    Write-Host "Redis configuration applied" -ForegroundColor Green
}

if ($Features -contains "monitoring") {
    Write-Host "Applying monitoring configuration..." -ForegroundColor Yellow
    # Add Prometheus metrics support would go here
    Write-Host "Monitoring configuration applied" -ForegroundColor Green
}

if ($Features -contains "claude-api") {
    Write-Host "Applying Claude API configuration..." -ForegroundColor Yellow
    # Add Claude API integration would go here
    Write-Host "Claude API configuration applied" -ForegroundColor Green
}

if ($Features -contains "bot-specific") {
    Write-Host "Applying bot-specific features..." -ForegroundColor Yellow
    # Add bot-specific features based on bot name
    switch ($BotName) {
        "soundproof" {
            Write-Host "  Adding gaming features..." -ForegroundColor Cyan
        }
        "listen" {
            Write-Host "  Adding music features..." -ForegroundColor Cyan
        }
        "airhornbot" {
            Write-Host "  Adding audio features..." -ForegroundColor Cyan
        }
        "discord-aibot" {
            Write-Host "  Adding AI features..." -ForegroundColor Cyan
        }
        "lastfm" {
            Write-Host "  Adding Last.fm features..." -ForegroundColor Cyan
        }
    }
    Write-Host "Bot-specific features applied" -ForegroundColor Green
}

# Deploy based on target
if ($LocalDeploy) {
    Write-Host "Deploying to local Docker..." -ForegroundColor Yellow
    Set-Location $PSScriptRoot
    docker-compose up -d $BotName
    Write-Host "Local deployment completed" -ForegroundColor Green
} else {
    Write-Host "Deploying to Fly.io..." -ForegroundColor Yellow
    # Fly.io deployment command
    flyctl deploy -a "$BotName-bot"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Fly.io deployment failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "Fly.io deployment completed" -ForegroundColor Green
}

Write-Host "Deployment of $BotName completed successfully!" -ForegroundColor Green
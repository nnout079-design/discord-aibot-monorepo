# Docker Setup Verification Script
# Verifies that all Docker components are properly configured
# Usage: .\verify-docker-setup.ps1

Write-Host "Verifying Docker Setup for Discord Bots..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$allPassed = $true

# 1. Check Docker installation
Write-Host "`n1. Checking Docker installation..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "   Docker installed: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Docker not installed or not in PATH" -ForegroundColor Red
    $allPassed = $false
}

# 2. Check Docker Compose
Write-Host "`n2. Checking Docker Compose..." -ForegroundColor Yellow
try {
    $composeVersion = docker-compose --version
    Write-Host "   Docker Compose installed: $composeVersion" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Docker Compose not installed" -ForegroundColor Red
    $allPassed = $false
}

# 3. Check Docker service status
Write-Host "`n3. Checking Docker service status..." -ForegroundColor Yellow
try {
    docker info > $null 2>&1
    Write-Host "   Docker service is running" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Docker service is not running" -ForegroundColor Red
    $allPassed = $false
}

# 4. Check required files
Write-Host "`n4. Checking required files..." -ForegroundColor Yellow
$requiredFiles = @(
    "docker-compose.yml",
    ".env.example",
    "docker-start.ps1",
    "docker-stop.ps1",
    "docker-build.ps1",
    "docker-status.ps1"
)

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "   Found: $file" -ForegroundColor Green
    } else {
        Write-Host "   Missing: $file" -ForegroundColor Red
        $allPassed = $false
    }
}

# 5. Check monitoring directory
Write-Host "`n5. Checking monitoring setup..." -ForegroundColor Yellow
if (Test-Path "monitoring\prometheus.yml") {
    Write-Host "   Monitoring configuration found" -ForegroundColor Green
} else {
    Write-Host "   WARNING: Monitoring configuration not found" -ForegroundColor Yellow
}

# 6. Check bot directories
Write-Host "`n6. Checking bot directories..." -ForegroundColor Yellow
$botDirs = @("soundproof", "lkeff-listen", "airhornbot", "discord-aibot", "lastfm-client")
foreach ($bot in $botDirs) {
    if (Test-Path $bot) {
        if (Test-Path "$bot\Dockerfile") {
            Write-Host "   Found: $bot with Dockerfile" -ForegroundColor Green
        } else {
            Write-Host "   WARNING: $bot missing Dockerfile" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   Missing: $bot directory" -ForegroundColor Red
        $allPassed = $false
    }
}

# 7. Check environment file
Write-Host "`n7. Checking environment configuration..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "   .env file exists" -ForegroundColor Green
    # Check for required variables
    $envContent = Get-Content .env
    $requiredVars = @("DISCORD_TOKEN", "POSTGRES_USER", "POSTGRES_PASSWORD", "MONGO_USER", "MONGO_PASSWORD")
    foreach ($var in $requiredVars) {
        if ($envContent -match "$var=") {
            Write-Host "   Found variable: $var" -ForegroundColor Green
        } else {
            Write-Host "   Missing variable: $var" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   .env file not found (created from .env.example)" -ForegroundColor Yellow
    Write-Host "   Run: Copy-Item .env.example .env" -ForegroundColor Cyan
}

# 8. Validate docker-compose configuration
Write-Host "`n8. Validating docker-compose configuration..." -ForegroundColor Yellow
try {
    docker-compose config > $null 2>&1
    Write-Host "   docker-compose.yml is valid" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: docker-compose.yml has syntax errors" -ForegroundColor Red
    $allPassed = $false
}

# 9. Check PowerShell execution policy
Write-Host "`n9. Checking PowerShell execution policy..." -ForegroundColor Yellow
$policy = Get-ExecutionPolicy
if ($policy -eq "Restricted") {
    Write-Host "   WARNING: Execution policy is Restricted" -ForegroundColor Yellow
    Write-Host "   Run: Set-ExecutionPolicy RemoteSigned" -ForegroundColor Cyan
} else {
    Write-Host "   Execution policy: $policy" -ForegroundColor Green
}

# 10. Check WSL2 (Windows specific)
Write-Host "`n10. Checking WSL2 status..." -ForegroundColor Yellow
try {
    $wslStatus = wsl --status 2>&1
    Write-Host "   WSL2 is available" -ForegroundColor Green
} catch {
    Write-Host "   WARNING: WSL2 not available (may affect Docker Desktop)" -ForegroundColor Yellow
}

# Final summary
Write-Host "`n========================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "VERIFICATION PASSED: All critical components are ready" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Configure .env file with your actual values" -ForegroundColor White
    Write-Host "2. Run: .\deploy-complete.ps1" -ForegroundColor White
    Write-Host "3. Or start with: .\docker-start.ps1" -ForegroundColor White
} else {
    Write-Host "VERIFICATION FAILED: Some components are missing or misconfigured" -ForegroundColor Red
    Write-Host "`nPlease fix the errors above before proceeding" -ForegroundColor Yellow
}

Write-Host "`nFor detailed setup instructions, see: DOCKER_WINDOWS_SETUP.md" -ForegroundColor Cyan
param([ValidateSet("build", "push", "full", "test", "status", "logs", "stop")][string]$Action = "full")
Write-Host "
✓ Deploy Script Loaded
" -ForegroundColor Green

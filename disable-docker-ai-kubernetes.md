# Docker Desktop Security Settings - Disable AI and Kubernetes

## 🔒 Required Security Actions

To complete the security hardening, you need to disable two features in Docker Desktop that create unnecessary security risks for this project.

---

## 🎯 Step 1: Disable Docker AI

**Why disable:** Docker AI sends your container data to external servers for analysis, which is a privacy concern for Discord bot development.

**How to disable:**

1. **Open Docker Desktop**
2. **Go to Settings** (gear icon in top right)
3. **Navigate to "General" tab**
4. **Find "Docker AI" section**
5. **Toggle OFF "Enable Docker AI"**
6. **Click "Apply & Restart"**

**Verification:**
```powershell
# Check if Docker AI is disabled
docker info | Select-String "AI"
```

---

## 🎯 Step 2: Disable Kubernetes

**Why disable:** Kubernetes adds significant attack surface and complexity that is not needed for this Discord bot project.

**How to disable:**

1. **Open Docker Desktop**
2. **Go to Settings** (gear icon in top right)
3. **Navigate to "Kubernetes" tab**
4. **Toggle OFF "Enable Kubernetes"**
5. **Click "Apply & Restart"**

**Verification:**
```powershell
# Check if Kubernetes is disabled
docker info | Select-String "Kubernetes"
kubectl version  # Should fail or show not running
```

---

## 🎯 Step 3: Apply and Restart Docker Desktop

After making both changes:

1. **Click "Apply & Restart"** in Docker Desktop
2. **Wait for Docker to restart** (may take 1-2 minutes)
3. **Verify Docker is running**: `docker info`

---

## ✅ Verification Steps

After disabling both features, run these commands to verify:

```powershell
# 1. Check Docker is running
docker info

# 2. Verify no AI references
docker info | Select-String "AI"

# 3. Verify Kubernetes is disabled
docker info | Select-String "Kubernetes"

# 4. Check containers still running
docker ps
```

**Expected results:**
- Docker info should show no AI-related settings
- Kubernetes should show as inactive or not present
- Your existing containers should still be running

---

## 🔄 Alternative: PowerShell Automation

If you prefer to disable these settings via PowerShell (requires Docker Desktop to be closed first):

```powershell
# Stop Docker Desktop
Stop-Process -Name "Docker Desktop" -Force

# Edit Docker Desktop settings file
$settingsPath = "$env:APPDATA\Docker\settings.json"
$settings = Get-Content $settingsPath | ConvertFrom-Json

# Disable Docker AI
$settings.EnableDockerAI = $false

# Disable Kubernetes  
$settings.KubernetesEnabled = $false

# Save settings
$settings | ConvertTo-Json | Set-Content $settingsPath

# Restart Docker Desktop
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

**Note:** Manual method via Docker Desktop UI is recommended for safety.

---

## 🚨 Troubleshooting

### Docker Desktop won't restart
1. **Wait 2-3 minutes** - Restart can take time
2. **Check WSL2**: `wsl --list -v`
3. **Restart WSL**: `wsl --shutdown` then restart Docker Desktop
4. **Check for errors**: Look at Docker Desktop logs

### Settings revert after restart
1. **Close Docker Desktop completely** before editing
2. **Check file permissions** on settings file
3. **Use Docker Desktop UI** instead of file editing

### Containers won't start after changes
1. **Verify Docker is running**: `docker info`
2. **Check docker-compose.yml** for syntax errors
3. **Restart containers**: `docker-compose restart`
4. **Review logs**: `docker-compose logs`

---

## 📋 Security Benefits

After disabling these features:

✅ **Reduced attack surface** - Fewer services running
✅ **Improved privacy** - No data sent to external AI services  
✅ **Simplified environment** - Only necessary services running
✅ **Better performance** - Less resource overhead
✅ **Clearer security boundaries** - Easier to monitor and secure

---

## 🎯 Next Steps

After completing these security actions:

1. **Verify security hardening**: Run security checks from SECURITY_HARDENING.md
2. **Update .env file**: Set strong passwords as documented
3. **Test deployment**: Try `docker-compose config` to validate configuration
4. **Proceed to Phase 1**: Begin secure slash command implementation

---

**Estimated Time:** 5 minutes
**Security Impact:** High
**Difficulty:** Easy
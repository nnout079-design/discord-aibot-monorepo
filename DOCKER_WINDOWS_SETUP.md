# Docker Windows Integration Guide

Complete Docker setup for Windows with comprehensive automation scripts and optimization for Discord bot development.

## 🚀 Quick Start

### 1. Initial Setup
```powershell
# Copy environment template
Copy-Item .env.example .env

# Edit .env with your actual values
notepad .env
```

### 2. Complete Deployment
```powershell
# Deploy all services with monitoring
.\deploy-complete.ps1 -IncludeMonitoring

# Or deploy without monitoring
.\deploy-complete.ps1
```

### 3. Management Scripts
```powershell
# Start all services
.\docker-start.ps1

# Stop all services
.\docker-stop.ps1

# Restart all services
.\docker-restart.ps1

# View logs
.\docker-logs.ps1

# Check status
.\docker-status.ps1

# Build images
.\docker-build.ps1

# Clean up resources
.\docker-clean.ps1
```

## 🗺️ Roadmap Deployment

Deploy specific roadmap phases:

```powershell
# Phase 1: Enhance Bot Logic (slash commands + bot-specific features)
.\deploy-roadmap.ps1 -Phase 1 -LocalDeploy

# Phase 2: Data Persistence (PostgreSQL + Redis)
.\deploy-roadmap.ps1 -Phase 2 -LocalDeploy

# Phase 3: Advanced Reasoning (Claude API + expanded engines)
.\deploy-roadmap.ps1 -Phase 3 -LocalDeploy

# Phase 4: Monitoring & Analytics (Prometheus + Grafana)
.\deploy-roadmap.ps1 -Phase 4 -LocalDeploy

# Phase 5: Advanced Features (user profiles, ML, etc.)
.\deploy-roadmap.ps1 -Phase 5 -LocalDeploy
```

## 🤖 Individual Bot Deployment

Deploy specific bots with custom features:

```powershell
# Deploy single bot with specific features
.\deploy-bot.ps1 -BotName soundproof -Features @("slash-commands", "database", "monitoring") -LocalDeploy

# Available features: slash-commands, database, redis, monitoring, claude-api, bot-specific
# Available bots: soundproof, listen, airhornbot, discord-aibot, lastfm
```

## 📊 Docker Compose Services

### Infrastructure Services
- **PostgreSQL**: Primary database (port 5432)
- **Redis**: Cache layer (port 6379)
- **MongoDB**: Document storage (port 27017)

### Bot Services
- **Soundproof**: Gaming bot (port 3001)
- **Listen**: MCP music bot (port 3002)
- **Airhornbot**: Audio utility (port 3003)
- **Discord AI Bot**: AI assistant (port 3004)
- **Last.fm Client**: Music tracking (port 3005)

### Monitoring Services
- **Prometheus**: Metrics collection (port 9090)
- **Grafana**: Metrics visualization (port 3000)

## 🔧 Windows Optimization

Optimize Docker for Windows performance:

```powershell
# Run as Administrator
.\docker-windows-optimization.ps1
```

This script:
- Configures WSL2 memory settings
- Optimizes Windows performance settings
- Creates Docker daemon configuration
- Sets up network optimizations

## 📁 File Structure

```
discord-aibot-monorepo/
├── docker-compose.yml          # Main orchestration file
├── .env.example                # Environment template
├── monitoring/
│   └── prometheus.yml          # Prometheus configuration
├── docker-start.ps1            # Start all services
├── docker-stop.ps1             # Stop all services
├── docker-restart.ps1          # Restart services
├── docker-logs.ps1             # View logs
├── docker-status.ps1           # Check status
├── docker-build.ps1            # Build images
├── docker-clean.ps1            # Clean resources
├── docker-windows-optimization.ps1  # Windows optimization
├── deploy-bot.ps1              # Individual bot deployment
├── deploy-roadmap.ps1          # Roadmap phase deployment
└── deploy-complete.ps1         # Complete deployment workflow
```

## 🔐 Environment Variables

Required variables in `.env`:

```env
# Discord Bot Token (required)
DISCORD_TOKEN=your_discord_token_here

# Database Configuration
POSTGRES_USER=discord
POSTGRES_PASSWORD=discord_password
POSTGRES_DB=discord_bots

# MongoDB Configuration
MONGO_USER=discord
MONGO_PASSWORD=discord_password

# API Keys (for specific bots)
CLAUDE_API_KEY=your_claude_api_key_here
LASTFM_API_KEY=your_lastfm_api_key_here
LASTFM_API_SECRET=your_lastfm_api_secret_here

# Monitoring
GRAFANA_PASSWORD=admin
```

## 🏥 Health Checks

All services include health checks:

```powershell
# Check service health
docker-compose ps

# View detailed health status
docker inspect --format='{{.State.Health.Status}}' <container_name>
```

## 📈 Monitoring

Access monitoring dashboards:

- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090

Default Prometheus targets:
- All bot services on port 3000
- Prometheus self-monitoring

## 🛠️ Troubleshooting

### Services won't start
```powershell
# Check logs
.\docker-logs.ps1

# Check status
.\docker-status.ps1

# Restart services
.\docker-restart.ps1
```

### Database connection issues
```powershell
# Verify database is healthy
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Test connection
docker-compose exec postgres pg_isready -U discord
```

### Performance issues
```powershell
# Run Windows optimization
.\docker-windows-optimization.ps1

# Check resource usage
docker stats

# Clean up resources
.\docker-clean.ps1
```

### Network issues
```powershell
# Check network configuration
docker network ls

# Inspect discord network
docker network inspect discord-aibot-monorepo_discord-network
```

## 🔄 Update Workflow

When updating bot code:

```powershell
# 1. Build new images
.\docker-build.ps1

# 2. Restart services
.\docker-restart.ps1

# 3. Verify deployment
.\docker-status.ps1
```

## 🧹 Cleanup

Remove all Docker resources:

```powershell
# Clean up containers, images, volumes, networks
.\docker-clean.ps1

# Or manually
docker-compose down -v
docker system prune -a
```

## 📚 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Discord.js Documentation](https://discord.js.org/docs)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)

## 🎯 Next Steps

1. Configure your `.env` file with actual values
2. Run `.\deploy-complete.ps1 -IncludeMonitoring` for full deployment
3. Access Grafana at http://localhost:3000 to set up dashboards
4. Use roadmap deployment scripts to implement new features
5. Monitor bot performance through Prometheus/Grafana

## 💡 Tips

- Always stop services before major updates
- Use separate `.env` files for development and production
- Monitor resource usage with `docker stats`
- Regular backups of database volumes are recommended
- Use health checks to ensure service reliability

## 🔒 Security Notes

- Never commit `.env` files to version control
- Use strong passwords for database credentials
- Rotate API keys regularly
- Keep Docker Desktop updated
- Use Docker Content Trust for image verification
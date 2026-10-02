# Fly.io Deployment Guide

Complete guide for deploying Discord bots to Fly.io.

## Prerequisites

1. **Install Fly.io CLI**
```bash
# Windows (using PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

2. **Authenticate with Fly.io**
```bash
fly auth login
```

3. **Set up secrets for each bot**

## Individual Bot Deployment

### 1. Last.fm Client Bot

```bash
cd lastfm-client

# Set secrets
fly secrets set DISCORD_TOKEN=your_discord_token
fly secrets set LASTFM_API_KEY=your_lastfm_api_key
fly secrets set LASTFM_API_SECRET=your_lastfm_api_secret
fly secrets set MIDI_BRIDGE_URL=your_midi_bridge_url (optional)

# Deploy
fly launch
fly deploy
```

### 2. Airhorn Bot

```bash
cd airhornbot

# Set secrets
fly secrets set DISCORD_TOKEN=your_discord_token

# Deploy
fly launch
fly deploy
```

### 3. Discord AI Bot

```bash
cd discord-aibot

# Set secrets
fly secrets set DISCORD_TOKEN=your_discord_token
fly secrets set CLAUDE_API_KEY=your_claude_api_key

# Deploy
fly launch
fly deploy
```

### 4. Listen Bot

```bash
cd lkeff-listen

# Set secrets
fly secrets set DISCORD_TOKEN=your_discord_token

# Deploy
fly launch
fly deploy
```

### 5. Soundproof Bot

```bash
cd soundproof

# Set secrets
fly secrets set DISCORD_TOKEN=your_discord_token
fly secrets set CLAUDE_API_KEY=your_claude_api_key
fly secrets set OPENAI_API_KEY=your_openai_api_key
fly secrets set EPIC_GAMING_API_KEY=your_epic_api_key
fly secrets set RAWG_API_KEY=your_rawg_api_key
fly secrets set STAR_CITIZEN_API_KEY=your_star_citizen_api_key
fly secrets set GRAND_THEFT_AUTO_V_API_KEY=your_gta_api_key

# Deploy
fly launch
fly deploy
```

## Deployment Verification

Check deployment status:
```bash
fly status
```

View logs:
```bash
fly logs
```

## Managing Deployments

### Scale applications
```bash
fly scale count 2
```

### Update environment variables
```bash
fly secrets set KEY=new_value
```

### Rollback to previous version
```bash
fly deploy --rollback
```

### Monitor resource usage
```bash
fly dashboard
```

## Configuration Notes

- **App Names**: Each bot has a unique app name in its `fly.toml`
- **Region**: Default is `iad` (IAD - Ashburn, Virginia)
- **Memory**: Default Fly.io allocation (512MB - 1GB)
- **CPU**: Default Fly.io allocation (1 CPU core)

## Troubleshooting

### Bot not connecting
```bash
fly logs
# Check for authentication errors or missing environment variables
```

### Build failures
```bash
fly deploy --verbose
# Check build logs for dependency issues
```

### Secrets not working
```bash
fly secrets list
# Verify all required secrets are set
```

## Cost Considerations

- Free tier: Up to 3 apps with 256MB RAM each
- Paid tier: $5-10/month per app depending on resources
- Database services: Additional cost if using Fly.io Postgres

## Post-Deployment

1. **Test bot commands** in Discord
2. **Monitor logs** for any errors
3. **Set up monitoring** if needed
4. **Configure auto-scaling** based on usage

## Migration from Docker Compose

If migrating from local Docker Compose:

1. Update environment variables for production
2. Remove database dependencies (use external services)
3. Update any hardcoded localhost references
4. Test thoroughly before full migration

## Additional Resources

- [Fly.io Documentation](https://fly.io/docs/)
- [Node.js on Fly.io](https://fly.io/docs/languages-and-frameworks/nodejs/)
- [Secrets Management](https://fly.io/docs/reference/secrets/)

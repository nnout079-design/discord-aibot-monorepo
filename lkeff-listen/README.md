# lkeff-listen

A companion listen bot with progress tracking and wellness commands.

## Commands

- `/listen info` — show bot info.
- `/listen status` — show status embed.
- `/wellness check` — analyze a message for crisis risk, emotion, and triage.
- `/wellness resources` — list crisis support resources.

## Scripts

```bash
npm ci
npm run build
npm run test
npm run lint
npm run format:check
```

## Environment variables

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
- `MENTAL_HEALTH_URL`
- `REDIS_URL` / `DATABASE_URL` (optional)

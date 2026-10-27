# airhornbot

Discord bot that rewards airhorn usage with XP, tiers, and leaderboards. Also includes wellness checks via the mental-health inference service.

## Commands

- `/airhorn play` — play the airhorn and earn XP.
- `/airhorn info` — show bot info.
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

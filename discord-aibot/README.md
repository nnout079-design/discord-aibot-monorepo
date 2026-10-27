# discord-aibot

Discord bot for defensive artifact analysis and AI reasoning. Analyzes owned or authorized artifacts without executing them, and surfaces results through Discord, an API, and an operator CLI.

## Features

- **Static artifact analysis** — detects type, entropy, strings, PE/ZIP signatures, unsafe archive paths, and expanded-size limits.
- **Discord `/artifact` command** — accepts an attachment after explicit authorization.
- **Analysis API** — `POST /analyze` with multipart or JSON payload.
- **Operator CLI** — `npm run cli -- path/to/file`.
- **Optional sandbox hook** — submits redacted metadata to a configured sandbox provider.
- **Wellness checks** via `/wellness check` and `/wellness resources`.

## Commands

- `/artifact` — analyze an attached artifact (requires explicit authorization).
- `/ask` — ask Claude with prompt screening.
- `/wellness check` — mental-health triage.
- `/wellness resources` — crisis resources.

## Endpoints

- `POST /analyze` — analyze an artifact.
- `GET /health` — service health.

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
- `CLAUDE_API_KEY`
- `MENTAL_HEALTH_URL`
- `SANDBOX_URL`, `SANDBOX_TOKEN` (optional)
- `REDIS_URL` / `DATABASE_URL` (optional)

## Safety

- Files are inspected, not executed.
- Executables are flagged with warnings.
- Unsafe archive paths and oversized files are rejected.
- Authorization must be explicitly confirmed in the Discord command.

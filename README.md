# discord-aibot-monorepo

A defensive, reliable Discord gaming/streaming companion monorepo. It includes multiple bots, a pair of Python inference services, and CI/CD that runs on every push.

## Packages

| Package | What it does |
| --- | --- |
| [`soundproof`](./soundproof) | Gaming/streaming companion: death postmortems, air support call-ins, deception tactics, drone/AI threat detection, emergency-vehicle alerts, and Pushbullet notifications. |
| [`discord-aibot`](./discord-aibot) | Defensive artifact analysis: Discord `/artifact` command, an analysis API, and an operator CLI. |
| [`airhornbot`](./airhornbot) | Airhorn rewards bot with XP tracking and wellness commands. |
| [`lkeff-listen`](./lkeff-listen) | Companion listen bot with progress tracking and wellness commands. |
| [`lastfm-client`](./lastfm-client) | Last.fm music tracking with DMX/lighting and companion sync endpoints. |
| [`lastfm-companion`](./lastfm-companion) | Last.fm studio renderer: MIDI, DMX, Art-Net, Reaper scripts, and video generation. |
| [`services/mental-health`](./services/mental-health) | Python FastAPI service for crisis detection, emotion analysis, and triage. |
| [`services/audio-events`](./services/audio-events) | Python FastAPI service for vehicle-noise audio classification. |

## Quickstart

Requires Node.js 20 and Python 3.11 for the inference services.

```bash
# Install all workspaces and the single root lockfile
npm ci

# Build, test, lint, and format-check everything
npm run build --workspaces
npm run test --workspaces
npm run lint --workspaces
npm run format:check --workspaces
```

To fix formatting: `npm run format --workspaces`.

## Environment variables

Each bot has an `.env.example` file in its package directory. At minimum every bot needs:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` or global registration support

Optional but commonly used:

- `REDIS_URL` / `DATABASE_URL`
- `MENTAL_HEALTH_URL`
- `AUDIO_EVENTS_URL`
- `PUSHBULLET_API_TOKEN` (soundproof)
- `CLAUDE_API_KEY` (discord-aibot / airhornbot / lkeff-listen)
- `LASTFM_API_KEY` / `LASTFM_API_SECRET` (lastfm-client)

## CI/CD

- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs `build`, `lint`, `test`, and `format:check` for every TypeScript workspace and Python `compileall` for the inference services.
- [`.github/workflows/deploy-fly.yml`](./.github/workflows/deploy-fly.yml) deploys to Fly.io only after the CI workflow succeeds on `main`/`master`.
- Set a `FLY_API_TOKEN` repository secret for automated Fly deploys.

## Safety boundaries

- Artifact analysis is static and metadata-only. Executables produce warnings; archives are inspected without extraction.
- REA use is limited to owned-or-authorized defensive diagnostics.
- Gaming deception/coaching is companion-side only: it never manipulates game clients, bypasses anti-cheat, manipulates memory, or automates multiplayer gameplay.
- Inferred opponent intent or correlations are treated as inference, not fact.

## License

MIT

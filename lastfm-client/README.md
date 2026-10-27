# lastfm-client

Last.fm music tracking bot with DMX/lighting control and companion sync endpoints.

## Features

- `/lastfm` commands for user info, recent tracks, top tracks, and track details.
- Sync endpoints for companion apps (now-playing, events, control).
- DMX/lighting integration (Tuya, Showtec Galaxy, Art-Net, Enttec Pro).
- MIDI generation and clock sync.

## Commands

- `/lastfm user <username>`
- `/lastfm recent <username> [limit]`
- `/lastfm top <username> [limit]`
- `/lastfm track <track> <artist>`
- `/wellness check` / `/wellness resources`

## Endpoints

- `GET /health` — service health.
- `POST /sync/now-playing` — now-playing lookup for companions.
- `POST /events/publish` — publish sync events.
- `POST /control/...` — lighting and playback control (token-protected).

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
- `LASTFM_API_KEY`, `LASTFM_API_SECRET`
- `COMPANION_TOKEN` — for `/sync` and `/control` endpoints.
- `MENTAL_HEALTH_URL`

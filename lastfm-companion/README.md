# lastfm-companion

Studio renderer and live performance companion for Last.fm-tracked songs. Generates MIDI arrangements, DMX/lighting shows, Reaper session scripts, and videos.

## Features

- MIDI orchestration from song metadata and generated parts.
- DMX/Air-Tok lighting control with rig files.
- Reaper session script export (`session.lua`).
- Video generation with optional AI backdrop.
- Live sync with the lastfm-client `/sync/now-playing` endpoint.

## Scripts

```bash
npm ci
npm run build
npm run test
npm run lint
npm run format:check

# Render a song
npm run studio -- "song=Artist - Title"
```

## Environment variables

- `COMPANION_TOKEN` — for lastfm-client sync.
- `BOT_URL` — lastfm-client base URL.
- `OPENAI_API_KEY` — for AI backdrops (optional).
- `RIG_FILE` — path to lighting rig JSON (optional).
- `SONGS_DIR` — local song database directory (optional).

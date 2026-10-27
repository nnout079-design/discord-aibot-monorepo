# soundproof

Gaming/streaming companion Discord bot. Ingests audio and video frames from a capture client, evaluates them against a rules engine, and posts coaching alerts back to Discord.

## Main features

- **Death postmortems** — correlates recent observations to infer likely causes, repeated-death risk, and preparation steps.
- **Air support call-ins** — `/game air-support` dispatches helicopters/planes on strike, escort, troop transport, recon, repair, and resupply missions with a 9-line-style brief, abort codes, and cooldowns.
- **Deception tactics** — `/game decoy` and `/game tactics` suggest and deploy feints, lures, bait detection, mimicry, and audio/information tricks.
- **Drone / AI threat detection** — vision and audio rules surface drones, UAVs, enemy NPCs, and autonomous threats.
- **Emergency vehicle alerts** — police, ambulance, fire-engine, and aircraft detections trigger Discord messages and optional Pushbullet pushes.
- **Pushbullet integration** — `PUSHBULLET_API_TOKEN` enables operator pushes for deaths, threats, and air-support tasking.

## Commands

- `/game air-support` — call in a mission.
- `/game air-abort` — abort an active asset.
- `/game air-status` — show fleet readiness.
- `/game decoy` — deploy a deception tactic.
- `/game tactics` — get context-aware deception suggestions.
- `/game postmortem` — review the last death analysis.
- `/game notifications` — verify Pushbullet connectivity.
- `/game push-test` — send an explicit test push.
- `/wellness check` — mental-health triage.
- `/wellness resources` — crisis resources.

## Endpoints

- `POST /stream/frame` — ingest a frame (JSON + `x-stream-token`).
- `POST /stream/audio` — ingest a base64 audio clip.
- `GET /health` — service health.
- `GET /stream/postmortem?guildId=...` — fetch the latest postmortem.

## Scripts

```bash
npm ci
npm run build
npm run test
npm run lint
npm run format:check
```

## Environment variables

See `.env.example`. Key vars:

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`
- `STREAM_INGEST_TOKEN`
- `MENTAL_HEALTH_URL`, `AUDIO_EVENTS_URL`
- `PUSHBULLET_API_TOKEN`, `PUSHBULLET_DEVICE_IDEN`
- `REDIS_URL` / `DATABASE_URL` (optional)

## Notes

Diagnostic and air-wing state are process-local, so history resets when the Fly machine restarts.

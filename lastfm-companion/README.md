# lastfm-companion

Runs on your PC and plays `/sync` song entries from lastfm-client-bot on a local MIDI output. It connects out to the bot, so your PC needs no public URL, port forwarding or tunnel.

On each `/sync start` it:
- plays the one-bar count-in and the chosen percussion pattern on the shared start timestamp,
- sends MIDI clock from the count-in and MIDI Start on the downbeat (Stop on `/sync stop` or at the end of the track), so a DAW set to follow external MIDI clock comes in on time,
- POSTs the event to `ELECTRON_URL`, if set, with `local.countInAt` / `local.startAt` converted to this PC's clock.

Before scheduling, it matches its clock to the bot's (`/sync/time`, best of 8 round trips, refreshed every 5 minutes). Your PC's clock does not need to be exact.

## Setup (Windows)

1. Install Node.js 20+ and, for a virtual MIDI port, [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html). Create a port in loopMIDI and select it as MIDI input in your DAW or synth.
2. In Discord, run `/companion` (needs Manage Server). It replies privately with your `.env` lines.
3. In this folder:

```
copy .env.example .env    (then paste the lines from /companion)
npm install
npm run outputs           (lists MIDI outputs; set MIDI_OUTPUT to part of the name)
npm start
```

## Start a song entry from your PC

With `npm start` running, open a second PowerShell window in this folder:

```
npm run sync afrobeat          (pattern: afrobeat, tabla, darbuka or taiko)
npm run sync taiko 120         (pattern and BPM)
npm run sync afrobeat lead=4 beats=3 user=YOUR_LASTFM_NAME
npm run sync                   (count-in only)
npm run sync stop
```

This does the same as `/sync start` / `/sync stop` in Discord, so Discord isn't needed. It uses `BOT_URL` and `COMPANION_TOKEN` from `.env`.

`MIDI_OUTPUT=none` logs the MIDI instead of sending it, which is useful for a first test. Set `MIDI_CLOCK=0` to send notes only.

## Electron app

When `ELECTRON_URL` is set (e.g. `http://127.0.0.1:3030/sync`), each event is POSTed as JSON. The body is the bot's `song-entry` / `song-stop` payload (see `lastfm-client/MIDI_PERCUSSION.md`) plus:

```json
"local": { "countInAt": 1790940008721.3, "startAt": 1790940010466.8, "endAt": 1790940225466.8, "clockOffsetMs": 5.7 }
```

Schedule against `local.startAt` with `Date.now()` in the Electron app.

Timing is limited by the OS timer resolution (a few ms on most PCs).

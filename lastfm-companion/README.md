# lastfm-companion

Runs on your PC and plays `/sync` song entries from lastfm-client-bot on a local MIDI output. It connects out to the bot, so your PC needs no public URL, port forwarding or tunnel.

On each `/sync start` it:
- plays the one-bar count-in and the chosen percussion pattern on the shared start timestamp,
- sends MIDI clock from the count-in and MIDI Start on the downbeat (Stop on `/sync stop` or at the end of the track), so a DAW set to follow external MIDI clock comes in on time,
- POSTs the event to `ELECTRON_URL`, if set, with `local.countInAt` / `local.startAt` converted to this PC's clock, plus the galaxy light `show`.
- Drives two galaxy light rigs over DMX if `lights.json` exists (see [Galaxy light rigs](#galaxy-light-rigs)).

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

### Ready-made receiver (Electron Fiddle)

`fiddle/` is a small Electron app that listens on `http://127.0.0.1:3030/sync` and shows the count-in, then bar.beat with a flash on every beat (red on the downbeat).

1. In Electron Fiddle, choose **File > Open** (Ctrl+O), pick the `lastfm-companion\fiddle` folder, then click **Run**.
2. Add the address to `.env` and restart the companion:
   ```
   Add-Content .env "ELECTRON_URL=http://127.0.0.1:3030/sync"
   npm start
   ```
3. Run `npm run sync afrobeat` in a second window.

Timing is limited by the OS timer resolution (a few ms on most PCs).

## Full rig (multiple MIDI ports)

```
npm run rig                 (lists MIDI outputs and how each rig section is routed)
npm run rig -- --write      (writes rig.json with every section, to edit ports/channels/latency)
```

Each section (percussion, bass racks, Moog, orchestra, choir, organ, Bangla, Balkan, Taiko, Roman, Hardanger fiddle, DJ) has a port, channel, General MIDI program, note range and `latencyMs`. Ports that don't exist on your PC fall back to `MIDI_OUTPUT` with one shared channel per instrument family, so the Windows GS synth still plays the whole arrangement. `npm run sync stop` sends all-notes-off on every port.

For each song the companion uses, in order: your MIDI file in `songs/`, the Lakh set (`npm run lakh`), a file made by `npm run transcribe "C:\Music\Artist - Title.mp3"` (needs `pip install demucs basic-pitch`), or a generated arrangement in the song's key and feel.

```
npm run sync "song=Queen - Bohemian Rhapsody"
```

## Song data from APIs

The bot looks up each song in several services and sends the result with every event; each one is optional:

- **Last.fm**: track tags, length, album cover, play counts, wiki summary, artist tags and similar artists.
- **GetSongBPM** (`GETSONGBPM_API_KEY` on the bot, free key from https://getsongbpm.com/api): tempo, time signature, key, danceability, acousticness, genres, year. Tempo and meter set the song entry; key and danceability shape generated arrangements.
- **MusicBrainz** (no key): song length when Last.fm has none.
- **OpenAI** (`OPENAI_API_KEY` here): AI video backdrop styled on the album cover.

## Studios

```
npm run studio setup                                   (once: General MIDI soundfont, plus FluidSynth and FFmpeg on Windows)
npm run studio "song=Radiohead - Creep"                (all studios)
npm run studio "song=Radiohead - Creep" studio=remaster
npm run studio user=YOUR_LASTFM_NAME                   (the song you're scrobbling now)
npm run studio reaper                                  (Reaper script that builds the live rig tracks)
```

Output goes to `studio\Artist - Title\`:

- **Pro studio**: `arrangement.mid`, one MIDI and WAV stem per rig group in `stems\`, and `session.lua` (Reaper: Actions > Load ReaScript) that loads the stems at the song's tempo.
- **Remaster studio**: `master.wav` and `master.mp3` (320 kbps), two-pass loudness normalised to -14 LUFS, -1 dBTP.
- **AI-video studio**: `video.mp4` (1280x720) with spectrum, waveform, beat and downbeat flashes, song facts, and a caption when each section enters.
- **Live studio**: `npm start` plays the same arrangement live across your MIDI ports. `mixxx\LastFM-Companion.midi.xml` lets Mixxx start deck 1 on the downbeat and stop it on `npm run sync stop` (MIDI port "Rig DJ").

Every stem is rendered with the MuseScore General soundfont, so the full mix comes out even without a DAW or sample libraries.

## Galaxy light rigs

Two galaxy rigs (A and B) follow every song entry on the same timestamps as the MIDI: dim in their song colour before the count-in, white flashes on the count-in clicks, then from the downbeat a beat pulse (strongest on beat 1), a colour step every bar (every two bars for calmer songs, rig B one colour ahead of rig A), mirrored pan sweeps, and a one-beat white strobe whenever a rig section comes in. `song-stop`, the end of the song and Ctrl+C black them out. The bot picks the colours and energy from the song's Last.fm tags, danceability and tempo, and sends them as `lights` in the `song-entry` event.

They run in three places:

1. **DMX fixtures (this companion).** Create `lights.json` and check it:
   ```
   npm run lights -- --write
   npm run lights ports
   npm run lights
   npm run lights test
   ```
   `ports` lists USB-DMX adapters, and `test` plays an 8-bar demo without the bot. In `lights.json`:
   - `output`: `open-dmx` (FTDI cables such as Enttec Open DMX), `enttec-pro` (Enttec DMX USB Pro, DMXking), `artnet` (network node; set `host` and `universe`), `log` (prints the DMX values, no hardware) or `none`.
   - `port`: the adapter's COM port, or `auto`.
   - `fixtures`: one entry per light, with `name`, `rig` (0 = A, 1 = B), DMX start `address` and `profile`:

     | profile | fixture | channels |
     |---|---|---|
     | `showtec-galaxy-360-18ch` | Showtec Galaxy 360, 18-channel mode | 18 |
     | `showtec-galaxy-360-10ch` | Showtec Galaxy 360, 10-channel mode (colour presets) | 10 |
     | `beamz-galaxy5-60ch` | beamZ Galaxy5 moving-head bar, 60-channel mode | 60 |
     | `beamz-galaxy5-11ch` | beamZ Galaxy5, 11-channel mode | 11 |
     | `rgbw-dimmer` | generic dimmer + R G B W | 5 |
     | `rgb` | generic R G B | 3 |

     Set the same channel mode and start address on the fixture's own display. `panRange` / `tiltRange` (e.g. `[0.3, 0.7]`) keep moving heads on stage, `invertPan` / `invertTilt` mirror them, and `latencyMs` sends frames early.

   With `lights.json` present, `npm start` drives the fixtures; without it, lights are off.
2. **Wi-Fi galaxy projectors (Tuya / Smart Life), from the bot.** Set `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_REGION` and `TUYA_DEVICE_IDS` on lastfm-client-bot (see `lastfm-client/.env.example`). The bot reads each projector's functions (power, nebula colour, stars/laser, rotation) and sends a colour change every few bars.
3. **On screen.** The Electron Fiddle window shows the two rigs as spinning galaxies with beams, and the AI-video studio (`npm run studio`) adds both rigs' beams to the music video.

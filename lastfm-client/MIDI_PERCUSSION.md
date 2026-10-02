# World Percussion MIDI

Last.fm registers `/percussion` with three subcommands:

- `/percussion list`
- `/percussion trigger instrument:djembe velocity:112`
- `/percussion pattern name:afrobeat`

Available instruments: `djembe`, `conga`, `bongo`, `tabla`, `darbuka`, `taiko`, `udu`, and `shekere`.

Triggers use MIDI channel 10 (zero-based channel 9) and General MIDI percussion note mappings. When `MIDI_BRIDGE_URL` is set, the bot POSTs JSON to that URL:

```json
{
  "type": "note-on",
  "channel": 9,
  "note": 36,
  "velocity": 112,
  "durationMs": 180,
  "instrument": "djembe",
  "requestedAt": "2026-09-16T00:00:00.000Z"
}
```

Without `MIDI_BRIDGE_URL`, the bot logs the trigger, which is useful for development. A Windows companion should receive the POST, send the note-on message to the selected MIDI output, wait `durationMs`, and send note-off.

## Synced song entry (`/sync`)

`/sync start [username] [lead] [bpm] [beats] [pattern]` arms a timed entry. The bot picks one start timestamp, `startAt` (epoch ms): the first bar line that is at least `lead` seconds plus one bar away. The grid is aligned to the epoch, so every receiver that schedules against wall-clock time lands on the same downbeat. Receivers must keep their clocks NTP-synced.

- **MIDI:** one bar of count-in clicks (note 37, channel 10), then the optional percussion pattern from the downbeat. With `MIDI_BRIDGE_BATCH=1`, `POST {MIDI_BRIDGE_URL}/batch` also gets `startAt`, which is when the count-in starts: hit `offsetMs` values count from it. `leadMs` is set to `startAt - now` for bridges that only read `leadMs`. `/sync stop` sends `POST {MIDI_BRIDGE_URL}/stop`.
- **Other cues (Electron app, lights, DAW):** set `SYNC_TARGETS` to a comma-separated list of URLs. Each URL gets `POST` with:

```json
{
  "type": "song-entry",
  "sentAt": 1790940000000,
  "countInAt": 1790940008727,
  "startAt": 1790940010473,
  "bpm": 137.5,
  "beatMs": 436.36,
  "barMs": 1745.45,
  "beatsPerBar": 4,
  "pattern": "afrobeat",
  "track": { "name": "Song", "artist": "Artist", "album": "Album", "url": "https://www.last.fm/...", "durationMs": 215000, "tags": ["house"] }
}
```

`/sync stop` sends `{ "type": "song-stop", "sentAt": ... }`. Without `SYNC_TARGETS`, the event is logged instead.

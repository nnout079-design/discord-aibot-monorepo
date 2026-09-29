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

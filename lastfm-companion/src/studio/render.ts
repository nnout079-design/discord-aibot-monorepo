import fs from "node:fs";
import { run, SOUNDFONT } from "./tools";

// Plays a MIDI file through the General MIDI soundfont into a 48 kHz WAV (no DAW or sample library needed).
export function renderMidi(midiPath: string, wavPath: string, gain = 0.5): void {
  if (!fs.existsSync(SOUNDFONT)) throw new Error(`Soundfont ${SOUNDFONT} is missing. Run: npm run studio setup`);
  run("fluidsynth", ["-ni", "-q", "-g", String(gain), "-r", "48000", "-F", wavPath, SOUNDFONT, midiPath]);
}

// Sums the stems into one 32-bit float WAV, so nothing clips before mastering.
export function mixStems(stems: string[], outPath: string): void {
  const inputs = stems.flatMap(stem => ["-i", stem]);
  const filter = stems.length > 1 ? ["-filter_complex", `amix=inputs=${stems.length}:normalize=0:dropout_transition=0`] : [];
  run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, ...filter, "-c:a", "pcm_f32le", "-ar", "48000", outPath]);
}

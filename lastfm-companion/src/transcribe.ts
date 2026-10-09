import { Midi } from "@tonejs/midi";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseMidi, PartNote } from "./song";

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a)$/i;
const STEMS = [
  { stem: "bass", name: "bass", program: 33 },
  { stem: "vocals", name: "vocals", program: 73 },
  { stem: "other", name: "other", program: 0 }
];

const pythonCommand = (): string[] => (process.env.PYTHON ?? (process.platform === "win32" ? "py -3.10" : "python3")).split(" ");

function python(args: string[], label: string): void {
  const [cmd, ...pre] = pythonCommand();
  const result = spawnSync(cmd, [...pre, ...args], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed. Install it with: ${pythonCommand().join(" ")} -m pip install demucs basic-pitch`);
  }
}

// Tempo from note onsets: the beat period (60-180 BPM) whose grid the onsets line up with best.
export function estimateBpm(onsetsMs: number[]): number {
  if (onsetsMs.length < 8) return 120;
  let best = { bpm: 120, score: -Infinity };
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const beat = 60000 / bpm;
    let sx = 0;
    let sy = 0;
    for (const t of onsetsMs) {
      const angle = (2 * Math.PI * t) / beat;
      sx += Math.cos(angle);
      sy += Math.sin(angle);
    }
    const score = Math.hypot(sx, sy) / onsetsMs.length + (bpm >= 80 && bpm <= 160 ? 0.02 : 0);
    if (score > best.score) best = { bpm, score };
  }
  return best.bpm;
}

function transcribe(file: string, outDir: string): string {
  const name = path.basename(file).replace(AUDIO_EXT, "");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-"));
  try {
    console.log(`\n[1/3] Separating stems of ${name} (Demucs) ...`);
    python(["-m", "demucs", "-n", "htdemucs", "-o", work, file], "Demucs");
    const stemDir = path.join(work, "htdemucs", name);
    console.log("[2/3] Transcribing bass, vocals and other (Basic Pitch) ...");
    const stems = STEMS.map(s => path.join(stemDir, `${s.stem}.wav`)).filter(p => fs.existsSync(p));
    python(["-c", "import sys; from basic_pitch.predict import main; sys.argv = ['basic-pitch'] + sys.argv[1:]; main()", work, ...stems], "Basic Pitch");

    console.log("[3/3] Merging into one MIDI file ...");
    const tracks = STEMS.map(s => {
      const mid = path.join(work, `${s.stem}_basic_pitch.mid`);
      return { ...s, notes: fs.existsSync(mid) ? parseMidi(fs.readFileSync(mid)).parts.flatMap(p => p.notes) : [] as PartNote[] };
    });
    const bpm = estimateBpm(tracks.flatMap(t => t.notes.map(n => n.timeMs)));
    const midi = new Midi();
    midi.header.setTempo(bpm);
    midi.header.name = name;
    tracks.forEach((t, i) => {
      const track = midi.addTrack();
      track.name = t.name;
      track.channel = i;
      track.instrument.number = t.program;
      t.notes.forEach(n => track.addNote({ midi: n.note, velocity: n.velocity / 127, time: n.timeMs / 1000, duration: n.durationMs / 1000 }));
    });
    const out = path.join(outDir, `${name}.mid`);
    fs.writeFileSync(out, midi.toArray());
    console.log(`Wrote ${out} (${bpm} BPM, ${tracks.map(t => `${t.name} ${t.notes.length}`).join(", ")} notes)`);
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// `npm run transcribe "C:\Music\Artist - Title.mp3"` (or a folder of audio files) writes songs/transcribed/Artist - Title.mid.
function main(): void {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) throw new Error('Usage: npm run transcribe "C:\\Music\\Artist - Title.mp3" (files or folders)');
  const outDir = path.join(process.env.SONGS_DIR ?? "songs", "transcribed");
  fs.mkdirSync(outDir, { recursive: true });
  const files = inputs.flatMap(input =>
    fs.statSync(input).isDirectory() ? fs.readdirSync(input).filter(f => AUDIO_EXT.test(f)).map(f => path.join(input, f)) : [input]
  );
  for (const file of files) {
    if (!path.basename(file).includes(" - ")) console.log(`Note: name ${path.basename(file)} as "Artist - Title" so it matches Last.fm.`);
    transcribe(path.resolve(file), outDir);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

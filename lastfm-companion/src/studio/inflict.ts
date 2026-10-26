import fs from "node:fs";
import path from "node:path";
import { GALAXY_PALETTE } from "../lights/show";
import { run } from "./tools";
import { BEAM_FILE, copyFont, galaxyBeams, makeBeam } from "./video";

export const BLEND_MODES = ["difference", "exclusion", "hardlight", "screen", "overlay", "lighten"] as const;
export const COLLISION_RATES = ["half_bar", "downbeat", "bar", "two_bars"] as const;
export type BlendMode = typeof BLEND_MODES[number];
export type CollisionRate = typeof COLLISION_RATES[number];

export interface Choreography {
  blendMode: BlendMode;
  collisionRate: CollisionRate;
  stutterGlitch: boolean;
  hudBadge: string;
  opacityRange: [number, number];
}

/** The parts of the bot's /sync/studio/diagnose plan the renderer uses. */
export interface InflictionDiagnosis {
  genre: { primaryGenre: string; energy: number; aestheticPalette: string[] };
  situationship: { headline: string; narrativeDiagnosis: string; dissonanceScore: number; inflictionChoreography: Choreography };
  source?: string;
  model?: string;
}

export interface InflictPlan {
  title: string;
  bpm: number;
  beatsPerBar: number;
  diagnosis: InflictionDiagnosis;
}

export const DEFAULT_DIAGNOSIS: InflictionDiagnosis = {
  genre: { primaryGenre: "Unclassified", energy: 0.6, aestheticPalette: GALAXY_PALETTE },
  situationship: {
    headline: "Undiagnosed Collision",
    narrativeDiagnosis: "No diagnosis from the bot; the videos collide on every downbeat.",
    dissonanceScore: 50,
    inflictionChoreography: { blendMode: "difference", collisionRate: "downbeat", stutterGlitch: false, hudBadge: "INFLICTION: UNDIAGNOSED", opacityRange: [0.35, 0.85] }
  },
  source: "default"
};

// Period between collisions and how long each one lasts, in seconds.
export function collisionWindow(rate: CollisionRate, beat: number, bar: number): { period: number; length: number } {
  switch (rate) {
    case "half_bar": return { period: bar / 2, length: beat / 2 };
    case "downbeat": return { period: bar, length: beat };
    case "bar": return { period: 2 * bar, length: bar };
    case "two_bars": return { period: 4 * bar, length: 2 * bar };
  }
}

const n = (x: number) => x.toFixed(5);

// ffmpeg filter for inputs 0 = audio, 1..videoCount = videos, videoCount+1 = beam sprite: every later video is
// inflicted onto the composite with the diagnosed blend mode (faint between collisions, full on each collision),
// optional snare/clap strobe on beats 2 and 4, the galaxy rigs in the diagnosed palette, spectrum, waveform and HUD.
export function inflictFilter(plan: InflictPlan, videoCount: number, font: string | null, dir: string): string {
  if (videoCount < 2) throw new Error("Need at least two videos to inflict on each other");
  const { genre, situationship } = plan.diagnosis;
  const c = situationship.inflictionChoreography;
  const beat = 60 / plan.bpm;
  const bar = beat * plan.beatsPerBar;
  const { period, length } = collisionWindow(c.collisionRate, beat, bar);
  const [lo, hi] = c.opacityRange;
  const text = (file: string, content: string, opts: string) => {
    fs.writeFileSync(path.join(dir, file), content);
    return font ? `,drawtext=fontfile=${font}:textfile=${file}:fontcolor=white:${opts}` : "";
  };
  const filters: string[] = [];
  for (let i = 1; i <= videoCount; i++) {
    filters.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30,setsar=1,format=gbrp[v${i}]`);
  }
  let current = "[v1]";
  for (let i = 2; i <= videoCount; i++) {
    const offset = n(((i - 2) * beat) % period);
    const enable = `lt(mod(t+${offset},${n(period)}),${n(length)})`;
    filters.push(
      `${current}split[ca${i}][cb${i}]`,
      `[v${i}]split[ka${i}][kb${i}]`,
      `[ca${i}][ka${i}]blend=all_mode=${c.blendMode}:all_opacity=${lo.toFixed(2)}[soft${i}]`,
      `[cb${i}][kb${i}]blend=all_mode=${c.blendMode}:all_opacity=${hi.toFixed(2)}[hard${i}]`,
      `[soft${i}][hard${i}]overlay=enable='${enable}'[m${i}]`
    );
    current = `[m${i}]`;
  }
  const backbeat = `lt(mod(t-${n(beat)},${n(2 * beat)}),0.06)`;
  filters.push(`${current}format=rgba${c.stutterGlitch ? `,negate=enable='${backbeat}'` : ""}[stage]`);
  filters.push(...galaxyBeams({ bpm: plan.bpm, beatsPerBar: plan.beatsPerBar, palette: genre.aestheticPalette, energy: genre.energy }, "[stage]", "[lit]", `[${videoCount + 1}:v]`));
  filters.push(
    `[lit]format=yuv420p[bg]`,
    `[0:a]showcqt=s=1280x200:fps=30:bar_v=8:sono_h=0:axis=0:bar_g=2[cqt]`,
    `[0:a]showwaves=s=1280x70:mode=cline:colors=white@0.7:rate=30[wave]`,
    `[bg][cqt]overlay=0:H-200:shortest=1[a]`,
    `[a][wave]overlay=0:H-270:shortest=1,`
      + `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.10:t=fill:enable='lt(mod(t,${n(bar)}),0.06)'`
      + text("title.txt", plan.title, "fontsize=40:x=40:y=30:shadowx=2:shadowy=2")
      + text("genre.txt", `${genre.primaryGenre} | ${Math.round(plan.bpm)} BPM | ${situationship.headline}`, "fontsize=22:x=42:y=84:fontcolor=white@0.85")
      + text("badge.txt", c.hudBadge, "fontsize=20:box=1:boxcolor=black@0.5:boxborderw=10:x=w-tw-40:y=36")
      + text("diagnosis.txt", situationship.narrativeDiagnosis.slice(0, 110), "fontsize=18:x=42:y=118:fontcolor=white@0.7")
      + "[v]"
  );
  return filters.join(";");
}

// Original sound: stream-copy formats MP4 can hold as-is, re-encode the rest (WAV, FLAC, Opus...) to 320 kbps AAC.
export function audioCodecArgs(audioPath: string): string[] {
  return /\.(m4a|aac|mp3|mp4|mov)$/i.test(audioPath) ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "320k"];
}

export function inflictVideos(audioPath: string, videos: string[], plan: InflictPlan, outPath: string): void {
  const dir = path.dirname(outPath);
  for (const file of [audioPath, ...videos]) if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const font = copyFont(dir);
  makeBeam(dir);
  fs.writeFileSync(path.join(dir, "inflict-filter.txt"), inflictFilter(plan, videos.length, font, dir));
  try {
    run("ffmpeg", [
      "-y", "-loglevel", "error", "-i", path.resolve(audioPath),
      ...videos.flatMap(v => ["-stream_loop", "-1", "-i", path.resolve(v)]),
      "-loop", "1", "-framerate", "30", "-i", BEAM_FILE,
      "-filter_complex_script", "inflict-filter.txt", "-map", "[v]", "-map", "0:a:0",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      ...audioCodecArgs(audioPath), "-shortest", path.basename(outPath)
    ], { cwd: dir });
  } finally {
    for (const f of fs.readdirSync(dir)) if (/^(title|genre|badge|diagnosis)\.txt$|^font\.ttf$|^inflict-filter\.txt$|^beam\.png$/.test(f)) fs.rmSync(path.join(dir, f));
  }
}

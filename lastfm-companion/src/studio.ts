import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { Arranger } from "./arranger";
import { SongEntryEvent } from "./player";
import { LightPlan } from "./lights/show";
import { loadRig } from "./rig";
import { entrances, scoreToMidi, sectionsByGroup } from "./studio/midifile";
import { liveRigScript, sessionScript } from "./studio/reaper";
import { measure, remaster } from "./studio/remaster";
import { mixStems, renderMidi } from "./studio/render";
import { setup } from "./studio/setup";
import { STUDIO_DIR } from "./studio/tools";
import { aiBackdrop, backdropPrompt, downloadImage, makeVideo } from "./studio/video";
import { BLEND_MODES, BlendMode, COLLISION_RATES, CollisionRate, DEFAULT_DIAGNOSIS, InflictionDiagnosis, inflictVideos } from "./studio/inflict";
import { allTags } from "./arranger";

dotenv.config();

type Track = NonNullable<SongEntryEvent["track"]>;
const MODES = ["pro", "remaster", "video"] as const;
type Mode = typeof MODES[number];

export interface StudioArgs {
  command: "render" | "setup" | "reaper" | "inflict";
  artist?: string;
  title?: string;
  username?: string;
  bpm?: number;
  beats?: number;
  modes: Set<Mode>;
  allStyles: boolean;
  ai: boolean;
  /** inflict: two or more video files, optional song audio, descriptions for the diagnosis and overrides. */
  videos: string[];
  audio?: string;
  describe: string[];
  originalSound: boolean;
  blend?: BlendMode;
  rate?: CollisionRate;
  strobe?: boolean;
}

const flag = (value: string) => value !== "0" && value !== "off" && value !== "false";

export function parseStudioArgs(argv: string[]): StudioArgs {
  const args: StudioArgs = { command: "render", modes: new Set(MODES), allStyles: false, ai: true, videos: [], describe: [], originalSound: true };
  for (const arg of argv) {
    if (arg === "setup" || arg === "reaper" || arg === "inflict") {
      args.command = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq < 0) throw new Error(`Unknown argument "${arg}". Use "song=Artist - Title" or user=LASTFM_NAME`);
    const key = arg.slice(0, eq).toLowerCase();
    const value = arg.slice(eq + 1).trim();
    if (key === "song") {
      const dash = value.indexOf(" - ");
      if (dash <= 0) throw new Error('song must look like "song=Artist - Title"');
      args.artist = value.slice(0, dash).trim();
      args.title = value.slice(dash + 3).trim();
    } else if (key === "user" || key === "username") args.username = value;
    else if (key === "bpm") args.bpm = Number(value);
    else if (key === "beats") args.beats = Number(value);
    else if (key === "style") args.allStyles = value === "all";
    else if (key === "ai") args.ai = flag(value);
    else if (key === "videos" || key === "video") args.videos.push(...value.split(",").map(v => v.trim()).filter(Boolean));
    else if (key === "audio") args.audio = value;
    else if (key === "describe") args.describe = value.split("|").map(v => v.trim()).filter(Boolean);
    else if (key === "original" || key === "originalsound") args.originalSound = flag(value);
    else if (key === "strobe") args.strobe = flag(value);
    else if (key === "blend") {
      if (!(BLEND_MODES as readonly string[]).includes(value)) throw new Error(`blend must be one of: ${BLEND_MODES.join(", ")}`);
      args.blend = value as BlendMode;
    } else if (key === "rate") {
      if (!(COLLISION_RATES as readonly string[]).includes(value)) throw new Error(`rate must be one of: ${COLLISION_RATES.join(", ")}`);
      args.rate = value as CollisionRate;
    }
    else if (key === "modes" || key === "studio") {
      const modes = value.split(",").map(m => m.trim().toLowerCase());
      const bad = modes.filter(m => !(MODES as readonly string[]).includes(m) && m !== "all");
      if (bad.length) throw new Error(`Unknown studio "${bad.join(", ")}". Use pro, remaster, video or all`);
      args.modes = new Set(modes.includes("all") ? MODES : modes as Mode[]);
    } else throw new Error(`Unknown option ${key}=`);
  }
  for (const [name, value, min, max] of [["bpm", args.bpm, 40, 240], ["beats", args.beats, 2, 12]] as const) {
    if (value !== undefined && !(value >= min && value <= max)) throw new Error(`${name} must be ${min}-${max}`);
  }
  if (args.command === "inflict") {
    if (args.videos.length < 2) throw new Error('Usage: npm run studio inflict "song=Artist - Title" videos=A.mp4,B.mp4 [audio=song.mp3] [original=0] [describe="A shows ...|B shows ..."]');
    if (!args.originalSound && !args.username && !args.artist) throw new Error("original=0 renders the MIDI arrangement, so it needs song= or user=");
  }
  if (args.command === "render" && !args.username && !args.artist) {
    throw new Error('Usage: npm run studio "song=Artist - Title" [studio=pro,remaster,video] [bpm=120]  or  npm run studio user=LASTFM_NAME');
  }
  return args;
}

// Song details (tags, length, tempo) from the bot's Last.fm lookup; falls back to just the name.
async function lookup(args: StudioArgs): Promise<{ track: Track; bpm: number | null; lights?: LightPlan }> {
  const token = process.env.COMPANION_TOKEN;
  const botUrl = (process.env.BOT_URL ?? "https://lastfm-client-bot.fly.dev").replace(/\/$/, "");
  const fallback = { track: { artist: args.artist ?? "", name: args.title ?? "", tags: [] }, bpm: null };
  if (!token) {
    if (args.username) throw new Error("COMPANION_TOKEN is missing from .env (needed for user=)");
    return fallback;
  }
  try {
    const response = await fetch(`${botUrl}/sync/now-playing`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args.username ? { username: args.username } : { artist: args.artist, title: args.title }),
      signal: AbortSignal.timeout(15000)
    });
    const json = await response.json() as { track?: Track; bpm?: number | null; lights?: LightPlan; error?: string };
    if (!response.ok || !json.track) throw new Error(json.error ?? `bot returned ${response.status}`);
    return { track: json.track, bpm: json.bpm ?? null, lights: json.lights };
  } catch (error) {
    if (args.username) throw error;
    console.log(`Last.fm lookup failed (${error instanceof Error ? error.message : error}); using the name only.`);
    return fallback;
  }
}

export function songFacts(track: Track, source: string, bpm: number, sections: number): string {
  return [
    source,
    `${Math.round(bpm)} BPM`,
    track.key && `key ${track.key}`,
    track.year && String(track.year),
    track.album,
    `${sections} sections`
  ].filter(Boolean).join(" | ");
}

const safe = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);

// MIDI arrangement for the song, rendered to per-section stems and a mix in studio/<Artist - Title>/.
async function arrangeMix(args: StudioArgs) {
  const rig = loadRig(process.env.RIG_FILE ?? "rig.json");
  const log = (message: string) => console.log(message);
  const arranger = new Arranger(rig, { songsDir: process.env.SONGS_DIR ?? "songs", generate: true, allStyles: args.allStyles, log });
  const { track, bpm: botBpm, lights } = await lookup(args);
  const title = `${track.artist} - ${track.name}`;
  const fileTempo = args.bpm === undefined ? arranger.tempoFor(track.artist, track.name, track.durationMs) : null;
  const bpm = args.bpm ?? fileTempo?.bpm ?? botBpm ?? 120;
  const beatsPerBar = args.beats ?? fileTempo?.beatsPerBar ?? track.timeSig ?? 4;
  const event: SongEntryEvent = {
    type: "song-entry", sentAt: 0, countInAt: 0, startAt: 0, bpm, beatMs: 60000 / bpm, barMs: (60000 / bpm) * beatsPerBar, beatsPerBar, pattern: null, track
  };
  const score = arranger.prepare(event);
  if (!score || score.notes.length === 0) throw new Error(`Nothing to play for ${title}`);

  const dir = path.resolve(STUDIO_DIR, safe(title));
  const stemDir = path.join(dir, "stems");
  fs.mkdirSync(stemDir, { recursive: true });
  console.log(`\n${title}: ${score.source}, ${bpm} BPM, ${score.sections.length} sections, ${(score.durationMs / 1000).toFixed(0)} s -> ${dir}`);

  fs.writeFileSync(path.join(dir, "arrangement.mid"), scoreToMidi(score, rig, bpm));
  const stems: { name: string; path: string }[] = [];
  for (const [group, sections] of sectionsByGroup(rig, score)) {
    const mid = path.join(stemDir, `${group}.mid`);
    const wav = path.join(stemDir, `${group}.wav`);
    fs.writeFileSync(mid, scoreToMidi(score, rig, bpm, sections));
    process.stdout.write(`Rendering ${group} (${sections.length} sections) ... `);
    renderMidi(mid, wav);
    console.log("done");
    stems.push({ name: group, path: wav });
  }
  const mix = path.join(dir, "mix.wav");
  mixStems(stems.map(s => s.path), mix);
  console.log(`Mix: ${mix}`);
  return { rig, track, lights, title, bpm, beatsPerBar, score, dir, stems, mix };
}

async function render(args: StudioArgs): Promise<void> {
  const { rig, track, lights, title, bpm, beatsPerBar, score, dir, stems, mix } = await arrangeMix(args);

  let master: string | undefined;
  if (args.modes.has("remaster")) {
    master = path.join(dir, "master.wav");
    const before = remaster(mix, master, path.join(dir, "master.mp3"));
    const after = measure(master);
    console.log(`Remaster: ${before.input_i} -> ${after.input_i} LUFS, true peak ${after.input_tp} dBTP (master.wav, master.mp3)`);
  }
  if (args.modes.has("pro")) {
    fs.writeFileSync(path.join(dir, "session.lua"), sessionScript(title, bpm, beatsPerBar, stems, master));
    console.log("Pro studio: arrangement.mid, stems/*.mid + *.wav, session.lua (Reaper: Actions > Load ReaScript)");
  }
  if (args.modes.has("video")) {
    const labels = score.sections.map(s => rig.sections[s]?.label ?? s);
    const art = path.join(dir, "cover.jpg");
    const hasArt = fs.existsSync(art) || await downloadImage(track.imageUrl, art);
    let backdrop: string | null = hasArt ? art : null;
    if (args.ai) {
      try {
        const file = path.join(dir, "backdrop.png");
        if (fs.existsSync(file) || await aiBackdrop(backdropPrompt(title, allTags(track), labels, track.summary), file, hasArt ? art : undefined)) backdrop = file;
        else console.log(`No OPENAI_API_KEY in .env: using ${hasArt ? "the album cover" : "a plain backdrop"}.`);
      } catch (error) {
        console.log(`${error instanceof Error ? error.message : error}; using ${hasArt ? "the album cover" : "a plain backdrop"}.`);
      }
    }
    process.stdout.write("Rendering video ... ");
    makeVideo(master ?? mix, backdrop, {
      title,
      subtitle: songFacts(track, score.source === "generated" ? "Generated arrangement" : `From ${score.source} MIDI`, bpm, score.sections.length),
      bpm, beatsPerBar, durationMs: score.durationMs, entrances: entrances(rig, score),
      palette: lights?.palette, energy: lights?.energy
    }, path.join(dir, "video.mp4"));
    console.log(`done: ${path.join(dir, "video.mp4")}`);
  }
}

// Bot diagnosis (Gemini, or the bot's heuristic) for the song and videos; counts against the user's studio quota.
async function diagnose(args: StudioArgs, descriptions: string[]): Promise<{ diagnosis: InflictionDiagnosis; track?: Track; bpm?: number | null }> {
  const token = process.env.COMPANION_TOKEN;
  if (!token || (!args.username && !args.artist)) {
    console.log(token ? "No song= or user=: using the default choreography." : "No COMPANION_TOKEN in .env: using the default choreography.");
    return { diagnosis: DEFAULT_DIAGNOSIS };
  }
  const botUrl = (process.env.BOT_URL ?? "https://lastfm-client-bot.fly.dev").replace(/\/$/, "");
  const response = await fetch(`${botUrl}/sync/studio/diagnose`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      ...(args.username && !args.artist ? { username: args.username } : { artist: args.artist, title: args.title }),
      userId: args.username ?? "cli", videos: descriptions, originalSound: args.originalSound
    }),
    signal: AbortSignal.timeout(45000)
  }).catch(error => { throw new Error(`Could not reach the bot for a diagnosis: ${error instanceof Error ? error.message : error}`); });
  const json = await response.json().catch(() => ({})) as { diagnosis?: InflictionDiagnosis; track?: Track; bpm?: number | null; summary?: string; error?: string };
  if (!response.ok || !json.diagnosis) throw new Error(json.error ?? `bot returned ${response.status}`);
  console.log(`Diagnosis by ${json.diagnosis.source === "gemini" ? json.diagnosis.model : "the bot's heuristic"}; quota ${json.summary ?? "n/a"}`);
  return { diagnosis: json.diagnosis, track: json.track, bpm: json.bpm };
}

async function inflict(args: StudioArgs): Promise<void> {
  const descriptions = args.videos.map((v, i) => args.describe[i] ?? path.parse(v).name);
  const result = await diagnose(args, descriptions);
  const c = result.diagnosis.situationship.inflictionChoreography;
  const diagnosis: InflictionDiagnosis = {
    ...result.diagnosis,
    situationship: {
      ...result.diagnosis.situationship,
      inflictionChoreography: { ...c, blendMode: args.blend ?? c.blendMode, collisionRate: args.rate ?? c.collisionRate, stutterGlitch: args.strobe ?? c.stutterGlitch }
    }
  };
  let audio = args.audio ?? args.videos[0];
  let title = result.track ? `${result.track.artist} - ${result.track.name}` : args.artist ? `${args.artist} - ${args.title}` : descriptions.join(" x ");
  let bpm = args.bpm ?? result.bpm ?? result.track?.bpm ?? 120;
  let beatsPerBar = args.beats ?? result.track?.timeSig ?? 4;
  let dir = path.resolve(STUDIO_DIR, safe(title));
  if (!args.originalSound) {
    const arranged = await arrangeMix(args);
    ({ title, bpm, beatsPerBar, dir } = arranged);
    audio = arranged.mix;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "diagnosis.json"), JSON.stringify(diagnosis, null, 2));
  const s = diagnosis.situationship;
  console.log(`\n${title}: ${diagnosis.genre.primaryGenre}, ${s.headline} (${s.dissonanceScore}% dissonance)`);
  console.log(`Inflicting ${args.videos.length} videos with ${s.inflictionChoreography.blendMode} every ${s.inflictionChoreography.collisionRate}, ${Math.round(bpm)} BPM, ${args.originalSound ? `original sound from ${path.basename(audio)}` : "MIDI arrangement audio"}`);
  const out = path.join(dir, "inflicted_video.mp4");
  process.stdout.write("Rendering ... ");
  inflictVideos(audio, args.videos, { title, bpm, beatsPerBar, diagnosis }, out);
  console.log(`done: ${out}`);
}

async function main(): Promise<void> {
  const args = parseStudioArgs(process.argv.slice(2));
  if (args.command === "setup") return setup();
  if (args.command === "reaper") {
    const file = path.resolve(STUDIO_DIR, "LastFM Rig.lua");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, liveRigScript(loadRig(process.env.RIG_FILE ?? "rig.json")));
    console.log(`Wrote ${file}. In Reaper: Actions > Show action list > New action > Load ReaScript, pick it, then Run.`);
    return;
  }
  if (args.command === "inflict") return inflict(args);
  await render(args);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

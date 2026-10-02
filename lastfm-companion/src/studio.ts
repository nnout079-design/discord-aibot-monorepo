import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { Arranger } from "./arranger";
import { SongEntryEvent } from "./player";
import { loadRig } from "./rig";
import { entrances, scoreToMidi, sectionsByGroup } from "./studio/midifile";
import { liveRigScript, sessionScript } from "./studio/reaper";
import { measure, remaster } from "./studio/remaster";
import { mixStems, renderMidi } from "./studio/render";
import { setup } from "./studio/setup";
import { STUDIO_DIR } from "./studio/tools";
import { aiBackdrop, backdropPrompt, downloadImage, makeVideo } from "./studio/video";
import { allTags } from "./arranger";

dotenv.config();

type Track = NonNullable<SongEntryEvent["track"]>;
const MODES = ["pro", "remaster", "video"] as const;
type Mode = typeof MODES[number];

export interface StudioArgs {
  command: "render" | "setup" | "reaper";
  artist?: string;
  title?: string;
  username?: string;
  bpm?: number;
  beats?: number;
  modes: Set<Mode>;
  allStyles: boolean;
  ai: boolean;
}

export function parseStudioArgs(argv: string[]): StudioArgs {
  const args: StudioArgs = { command: "render", modes: new Set(MODES), allStyles: false, ai: true };
  for (const arg of argv) {
    if (arg === "setup" || arg === "reaper") {
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
    else if (key === "ai") args.ai = value !== "0" && value !== "off";
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
  if (args.command === "render" && !args.username && !args.artist) {
    throw new Error('Usage: npm run studio "song=Artist - Title" [studio=pro,remaster,video] [bpm=120]  or  npm run studio user=LASTFM_NAME');
  }
  return args;
}

// Song details (tags, length, tempo) from the bot's Last.fm lookup; falls back to just the name.
async function lookup(args: StudioArgs): Promise<{ track: Track; bpm: number | null }> {
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
    const json = await response.json() as { track?: Track; bpm?: number | null; error?: string };
    if (!response.ok || !json.track) throw new Error(json.error ?? `bot returned ${response.status}`);
    return { track: json.track, bpm: json.bpm ?? null };
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

async function render(args: StudioArgs): Promise<void> {
  const rig = loadRig(process.env.RIG_FILE ?? "rig.json");
  const log = (message: string) => console.log(message);
  const arranger = new Arranger(rig, { songsDir: process.env.SONGS_DIR ?? "songs", generate: true, allStyles: args.allStyles, log });
  const { track, bpm: botBpm } = await lookup(args);
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
      bpm, beatsPerBar, durationMs: score.durationMs, entrances: entrances(rig, score)
    }, path.join(dir, "video.mp4"));
    console.log(`done: ${path.join(dir, "video.mp4")}`);
  }
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
  await render(args);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

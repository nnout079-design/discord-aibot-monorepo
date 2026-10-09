import * as dotenv from "dotenv";
import { parseSyncArgs, SyncArgs } from "./args";
import { Arranger } from "./arranger";
import { loadRig } from "./rig";

dotenv.config();

interface StartResponse {
  countInAt: number;
  startAt: number;
  bpm: number;
  beatsPerBar: number;
  pattern: string | null;
  track: { artist: string; name: string } | null;
  companions: number;
  now: number;
  error?: string;
}

interface NowPlayingResponse {
  track?: { artist: string; name: string; durationMs?: number };
  error?: string;
}

async function post<T>(botUrl: string, token: string, path: string, body: object): Promise<T> {
  const response = await fetch(`${botUrl}/sync/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (response.status === 401) throw new Error("The bot rejected COMPANION_TOKEN. Check the token in .env");
  if (response.status === 404 && path === "now-playing") throw new Error("The bot is too old for user= lookups; redeploy lastfm-client-bot");
  if (!response.ok) throw new Error(result.error ?? `Bot returned ${response.status}`);
  return result;
}

// Pins the song (so it can't change between lookup and start) and, if a local MIDI file
// matches it, starts on that file's own tempo and meter.
async function resolveSong(body: SyncArgs["body"], botUrl: string, token: string): Promise<void> {
  let durationMs: number | undefined;
  if (body.username && !body.artist) {
    const { track } = await post<NowPlayingResponse>(botUrl, token, "now-playing", { username: body.username });
    if (!track) return;
    body.artist = track.artist;
    body.title = track.name;
    durationMs = track.durationMs;
    delete body.username;
  }
  if (!body.artist || !body.title || body.bpm !== undefined) return;
  const arranger = new Arranger(loadRig(), { songsDir: process.env.SONGS_DIR ?? "songs", generate: false, allStyles: false, log: console.log });
  const tempo = arranger.tempoFor(body.artist, body.title, durationMs);
  if (!tempo) return;
  console.log(`Found ${tempo.path}: ${tempo.bpm} BPM, ${tempo.beatsPerBar} beats per bar`);
  body.bpm = Math.min(240, Math.max(40, tempo.bpm));
  body.beats ??= Math.min(12, Math.max(2, tempo.beatsPerBar));
}

async function main(): Promise<void> {
  const { action, body } = parseSyncArgs(process.argv.slice(2));
  const botUrl = (process.env.BOT_URL ?? "https://lastfm-client-bot.fly.dev").replace(/\/$/, "");
  const token = process.env.COMPANION_TOKEN;
  if (!token) throw new Error("COMPANION_TOKEN is missing from .env");

  if (action === "stop") {
    const result = await post<{ stopped?: boolean }>(botUrl, token, "stop", body);
    console.log(result.stopped ? "Cancelled before the downbeat." : "Stopped.");
    return;
  }
  await resolveSong(body, botUrl, token);
  const r = await post<StartResponse>(botUrl, token, "start", body);
  const seconds = (at: number) => ((at - r.now) / 1000).toFixed(1);
  const song = r.track ? `${r.track.artist} - ${r.track.name}` : r.pattern ?? "count-in only";
  console.log(`Armed ${song} at ${r.bpm.toFixed(2)} BPM: count-in in ${seconds(r.countInAt)} s, downbeat in ${seconds(r.startAt)} s.`);
  console.log(r.companions
    ? `${r.companions} companion(s) connected and playing it.`
    : "No companion is connected. Start one with `npm start` in another window first.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

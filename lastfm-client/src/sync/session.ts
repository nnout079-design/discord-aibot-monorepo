import { createLastFmApi, LastFmApi } from "../lastfm/api";
import { triggerBatch } from "../midi/bridge";
import { pickBpm, stepSeconds } from "../midi/humanize";
import { schedulePattern } from "../midi/schedule";
import { createHit, PercussionHit, PERCUSSION_PATTERNS } from "../midi/world-percussion";
import { companionHub, ControlHandler } from "./companion-hub";
import { EntryPlan, entryHits, notifyTargets, planEntry, songEntryEvent, SongStopEvent, TrackAttributes } from "./entry";

export interface SyncSession {
  plan: EntryPlan;
  pattern: string | null;
  track: TrackAttributes | null;
  abort: AbortController;
  timer: NodeJS.Timeout;
}

export interface EntryOptions {
  bpm?: number;
  leadMs?: number;
  beatsPerBar?: number;
  pattern?: string | null;
  track?: TrackAttributes | null;
  onDownbeat?: (session: SyncSession) => void;
}

const sessions = new Map<string, SyncSession>();

export async function nowPlaying(api: LastFmApi, username: string): Promise<TrackAttributes> {
  const [track] = await api.getRecentTracks(username, 1);
  if (!track || track["@attr"]?.nowplaying !== "true") throw new Error(`${username} is not scrobbling anything right now`);
  const artist = track.artist["#text"];
  const info = await api.getTrackInfo(track.name, artist).catch(() => undefined);
  return {
    name: track.name,
    artist,
    album: track.album?.["#text"] || info?.album,
    url: track.url,
    durationMs: info?.durationMs,
    tags: info?.tags ?? []
  };
}

export function getSession(key: string): SyncSession | undefined {
  return sessions.get(key);
}

function cancel(key: string): boolean {
  const session = sessions.get(key);
  if (!session) return false;
  session.abort.abort();
  clearTimeout(session.timer);
  sessions.delete(key);
  return true;
}

// Stops the entry armed under `key`, or every armed entry when no key is given.
export async function stopEntry(key?: string): Promise<boolean> {
  const keys = key === undefined ? [...sessions.keys()] : [key];
  const stopped = keys.map(cancel).some(Boolean);
  if (stopped) {
    const event: SongStopEvent = { type: "song-stop", sentAt: Date.now() };
    companionHub.publish(event);
    await notifyTargets(event);
  }
  return stopped;
}

export async function armEntry(key: string, options: EntryOptions = {}): Promise<SyncSession> {
  cancel(key);
  const seed = process.env.HUMANIZE_SEED ?? "";
  const bpm = options.bpm ?? pickBpm(seed);
  const plan = planEntry(Date.now(), options.leadMs ?? 8000, bpm, options.beatsPerBar ?? 4);
  const pattern = options.pattern ?? null;
  const track = options.track ?? null;
  const patternHits = pattern
    ? schedulePattern(PERCUSSION_PATTERNS[pattern].map(id => createHit(id)).filter((hit): hit is PercussionHit => hit !== undefined), seed, bpm).hits
    : [];

  const abort = new AbortController();
  const session: SyncSession = {
    plan,
    pattern,
    track,
    abort,
    timer: setTimeout(() => {
      sessions.delete(key);
      options.onDownbeat?.(session);
    }, Math.max(0, plan.startAt - Date.now()))
  };
  sessions.set(key, session);

  const hits = entryHits(plan, patternHits);
  triggerBatch({ bpm, stepMs: stepSeconds(bpm) * 1000, hits }, 9, { startAt: plan.countInAt, signal: abort.signal })
    .catch(error => console.error("Sync MIDI batch failed:", error));
  const event = songEntryEvent(plan, pattern, track, Date.now(), { channel: 9, hits });
  companionHub.publish(event);
  await notifyTargets(event);
  return session;
}

export interface StartRequest {
  pattern?: string;
  bpm?: number;
  lead?: number;
  beats?: number;
  username?: string;
}

function inRange(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

export function parseStartRequest(body: unknown): StartRequest {
  if (body === null || body === undefined) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new Error("body must be a JSON object");
  const input = body as Record<string, unknown>;
  const { pattern, username } = input;
  if (pattern !== undefined && pattern !== null && (typeof pattern !== "string" || !(pattern in PERCUSSION_PATTERNS))) {
    throw new Error(`pattern must be one of: ${Object.keys(PERCUSSION_PATTERNS).join(", ")}`);
  }
  if (username !== undefined && username !== null && typeof username !== "string") throw new Error("username must be a string");
  return {
    pattern: typeof pattern === "string" ? pattern : undefined,
    bpm: inRange(input.bpm, "bpm", 40, 240),
    lead: inRange(input.lead, "lead", 2, 60),
    beats: inRange(input.beats, "beats", 2, 12),
    username: typeof username === "string" && username ? username : undefined
  };
}

export const COMPANION_SESSION = "companion";

// Lets a PC companion arm or stop a song entry over the hub, without Discord.
export const companionControl: ControlHandler = async (action, body) => {
  if (action === "stop") return { status: 200, body: { stopped: await stopEntry() } };

  let request: StartRequest;
  try {
    request = parseStartRequest(body);
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }
  let track: TrackAttributes | null = null;
  if (request.username) {
    const api = createLastFmApi();
    if (!api) return { status: 503, body: { error: "Last.fm API is not configured on the bot" } };
    try {
      track = await nowPlaying(api, request.username);
    } catch (error) {
      return { status: 422, body: { error: error instanceof Error ? error.message : "Could not read now playing from Last.fm" } };
    }
  }
  const { plan, pattern } = await armEntry(COMPANION_SESSION, {
    bpm: request.bpm,
    leadMs: request.lead === undefined ? undefined : request.lead * 1000,
    beatsPerBar: request.beats === undefined ? undefined : Math.round(request.beats),
    pattern: request.pattern,
    track
  });
  return {
    status: 200,
    body: { countInAt: plan.countInAt, startAt: plan.startAt, bpm: plan.bpm, beatsPerBar: plan.beatsPerBar, pattern, track, companions: companionHub.connected, now: Date.now() }
  };
};

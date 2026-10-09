import { TrackAttributes } from "./entry";

const API_URL = "https://api.getsong.co/search/";

interface GetSongResult {
  title?: string;
  tempo?: string | number;
  time_sig?: string | number;
  key_of?: string;
  open_key?: string;
  danceability?: string | number;
  acousticness?: string | number;
  artist?: { name?: string; genres?: string[] };
  album?: { year?: string | number };
}

export interface SongFacts {
  bpm?: number;
  timeSig?: number;
  key?: string;
  openKey?: string;
  danceability?: number;
  acousticness?: number;
  genres?: string[];
  year?: number;
}

const simplify = (text: string) => text.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, "");
const num = (value: unknown, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function songFacts(result: GetSongResult): SongFacts {
  return {
    bpm: num(result.tempo, 40, 240),
    timeSig: num(result.time_sig, 2, 12),
    key: result.key_of || undefined,
    openKey: result.open_key || undefined,
    danceability: num(result.danceability, 0, 100),
    acousticness: num(result.acousticness, 0, 100),
    genres: result.artist?.genres?.length ? result.artist.genres : undefined,
    year: num(result.album?.year, 1000, 3000)
  };
}

// Tempo, meter, key, danceability and acousticness from GetSongBPM (https://getsongbpm.com) when
// GETSONGBPM_API_KEY is set; null if the key is missing or the song is unknown.
export async function lookupSong(track: Pick<TrackAttributes, "artist" | "name">, fetchImpl: typeof fetch = fetch): Promise<SongFacts | null> {
  const key = process.env.GETSONGBPM_API_KEY;
  if (!key) return null;
  const url = new URL(API_URL);
  url.searchParams.set("type", "both");
  url.searchParams.set("lookup", `song:${track.name} artist:${track.artist}`);
  url.searchParams.set("limit", "5");
  try {
    const response = await fetchImpl(url, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const json = await response.json() as GetSongResult[] | { search?: GetSongResult[] | { error?: string } };
    const results = Array.isArray(json) ? json : Array.isArray(json.search) ? json.search : [];
    const exact = results.find(r => simplify(r.title ?? "") === simplify(track.name) && simplify(r.artist?.name ?? "") === simplify(track.artist));
    const best = exact ?? results[0];
    return best ? songFacts(best) : null;
  } catch {
    return null;
  }
}

export async function lookupBpm(track: Pick<TrackAttributes, "artist" | "name">, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  return (await lookupSong(track, fetchImpl))?.bpm ?? null;
}

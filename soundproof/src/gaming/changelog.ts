import { DEFAULT_TUNING, StealthTuning } from "./stealth-circuit";

export interface ChangelogEntry {
  title: string;
  date: string;
  url?: string;
  text: string;
}

export const KNOWN_STEAM_APPS: Record<string, number> = {
  "grand theft auto v": 271590,
  "rocket league": 252950,
  "counter-strike 2": 730
};

const tuningByGame = new Map<string, StealthTuning>();
const fetchedAtByGame = new Map<string, number>();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGame(game: string): string {
  return game.trim().toLowerCase();
}

function copyTuning(tuning: StealthTuning): StealthTuning {
  return { ...tuning, sources: tuning.sources.map(source => ({ ...source })) };
}

export function stripMarkup(value: string): string {
  return value.replace(/\[[^\]]*]/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export async function fetchSteamChangelog(appId: number, count = 10, fetchImpl: typeof fetch = fetch): Promise<ChangelogEntry[]> {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=${count}&maxlength=0&format=json`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Steam changelog request failed: ${response.status}`);

  const payload: unknown = await response.json();
  const appnews = isRecord(payload) ? payload.appnews : undefined;
  const newsitems = isRecord(appnews) ? appnews.newsitems : undefined;
  if (!Array.isArray(newsitems)) throw new Error("Steam changelog response did not include newsitems");
  return newsitems.flatMap(item => {
    if (!isRecord(item) || typeof item.title !== "string" || typeof item.contents !== "string" ||
        typeof item.date !== "number" || !Number.isFinite(item.date)) {
      return [];
    }
    return [{
      title: item.title,
      date: new Date(item.date * 1000).toISOString(),
      ...(typeof item.url === "string" ? { url: item.url } : {}),
      text: stripMarkup(item.contents)
    }];
  });
}

export async function fetchChangelogUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<ChangelogEntry[]> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("changelog URL must use https");
  const response = await fetchImpl(parsed.toString());
  if (!response.ok) throw new Error(`Changelog request failed: ${response.status}`);
  const text = stripMarkup((await response.text()).slice(0, 200_000));
  return [{
    title: parsed.hostname,
    date: new Date().toISOString(),
    url: parsed.toString(),
    text
  }];
}

function hasAny(text: string, expression: RegExp): boolean {
  return expression.test(text);
}

function recordSource(tuning: StealthTuning, entry: ChangelogEntry, rule: string, sentence: string): void {
  tuning.sources.push({
    title: entry.title,
    date: entry.date,
    rule,
    excerpt: sentence.trim().slice(0, 160)
  });
}

export function deriveTuning(entries: ChangelogEntry[], base: StealthTuning = DEFAULT_TUNING): StealthTuning {
  const tuning = copyTuning(base);
  tuning.sources = [];

  for (const entry of entries) {
    const fired = new Set<string>();
    const sentences = entry.text.split(/(?<=[.!?\n])\s+/).map(sentence => sentence.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const text = sentence.toLowerCase();
      const mark = (rule: string): boolean => {
        if (fired.has(rule)) return false;
        fired.add(rule);
        recordSource(tuning, entry, rule, sentence);
        return true;
      };

      const lightsIndestructible =
        /\b(lights?|lamps?)\b[^.]{0,40}\b(can no longer be (shot|destroyed)|no longer destructible|indestructible)\b/.test(text) ||
        /\bindestructible (lights?|lamps?)\b/.test(text);
      if (lightsIndestructible) {
        if (mark("lights-indestructible")) tuning.lightsShootable = false;
      } else {
        const lightsDestructible =
          /\b(lights?|lamps?|bulbs?|streetlights?)\b[^.]{0,40}\b(can (now )?be (shot|destroyed)|are (now )?destructible|shoot(ing)? out)\b/.test(text) ||
          /\bdestructible (lights?|lamps?)\b/.test(text);
        if (lightsDestructible && mark("lights-destructible")) tuning.lightsShootable = true;
      }

      const lightSubject = /\b(light(s|ing)?|flashlights?|illumination|brightness|visibility)\b/.test(text);
      const lightBuff = /\b(increase[sd]?|brighter|improved|buff(ed)?|more visible|stronger)\b/.test(text);
      const lightNerf = /\b(decrease[sd]?|darker|reduced|nerf(ed)?|less visible|weaker)\b/.test(text);
      if (lightSubject && !(lightBuff && lightNerf)) {
        if (lightBuff && mark("light-buff")) tuning.lightWeight = Math.min(1.5, tuning.lightWeight * 1.15);
        if (lightNerf && mark("light-nerf")) tuning.lightWeight = Math.max(0.6, tuning.lightWeight * 0.9);
      }

      const camoSubject = /\b(camo|camouflage|ghillie|stealth)\b/.test(text);
      const camoBuff = /\b(buff(ed)?|improved|more effective|stronger|increase[sd]?)\b/.test(text);
      const camoNerf = /\b(nerf(ed)?|reduced|less effective|weaker|decrease[sd]?)\b/.test(text);
      if (camoSubject && !(camoBuff && camoNerf)) {
        if (camoNerf && mark("camo-nerf")) tuning.camoMultiplier = Math.max(0.5, tuning.camoMultiplier * 0.85);
        if (camoBuff && mark("camo-buff")) tuning.camoMultiplier = Math.min(1.3, tuning.camoMultiplier * 1.1);
      }

      const shotsSubject = /\b(gunshots?|gunfire|suppressors?|silencers?|weapon noise|shot noise)\b/.test(text);
      const shotsLouder = /\b(louder|increase[sd]?|reveal(s|ed)?|nerf(ed)?|audible from further)\b/.test(text);
      const shotsQuieter = /\b(quieter|reduced|decrease[sd]?|buff(ed)?)\b/.test(text);
      if (shotsSubject && shotsLouder && mark("shots-louder")) {
        tuning.shotRevealRadius = Math.min(30, tuning.shotRevealRadius + 4);
        tuning.shootOutAfterSeconds = Math.min(20, tuning.shootOutAfterSeconds + 2);
      }
      if (shotsSubject && shotsQuieter && mark("shots-quieter")) {
        tuning.shotRevealRadius = Math.max(4, tuning.shotRevealRadius - 2);
      }
    }
  }

  return tuning;
}

export function setGameTuning(game: string, tuning: StealthTuning): void {
  const key = normalizeGame(game);
  tuningByGame.set(key, copyTuning(tuning));
  fetchedAtByGame.set(key, Date.now());
}

export function getGameTuning(game: string): StealthTuning {
  return copyTuning(tuningByGame.get(normalizeGame(game)) ?? DEFAULT_TUNING);
}

export async function refreshGameTuning(
  game: string,
  opts: { appId?: number; url?: string; fetchImpl?: typeof fetch } = {}
): Promise<StealthTuning> {
  const key = normalizeGame(game);
  const fetchImpl = opts.fetchImpl ?? fetch;
  let entries: ChangelogEntry[];
  if (opts.url) {
    entries = await fetchChangelogUrl(opts.url, fetchImpl);
  } else {
    const appId = opts.appId ?? KNOWN_STEAM_APPS[key];
    if (appId === undefined) throw new Error("no changelog source");
    entries = await fetchSteamChangelog(appId, 10, fetchImpl);
  }
  const tuning = deriveTuning(entries);
  setGameTuning(key, tuning);
  return copyTuning(tuning);
}

export async function getOrRefreshTuning(game: string, fetchImpl: typeof fetch = fetch): Promise<StealthTuning> {
  const key = normalizeGame(game);
  const cachedAt = fetchedAtByGame.get(key);
  const cached = tuningByGame.get(key);
  if (cached && cachedAt !== undefined && Date.now() - cachedAt < SIX_HOURS_MS) return copyTuning(cached);

  if (Object.prototype.hasOwnProperty.call(KNOWN_STEAM_APPS, key)) {
    try {
      return await refreshGameTuning(key, { appId: KNOWN_STEAM_APPS[key], fetchImpl });
    } catch (error) {
      console.warn(`Stealth tuning refresh failed for ${key}:`, error);
      return copyTuning(cached ?? DEFAULT_TUNING);
    }
  }
  return getGameTuning(key);
}

import { Pool } from "pg";
import { TrackAttributes } from "../../sync/entry";

export interface GenreDiagnosis {
  primaryGenre: string;
  subgenres: string[];
  energy: number; // 0.0 - 1.0
  aestheticPalette: string[]; // hex codes e.g. ["#ff0055", "#00ffff"]
  visualTempoFactor: number; // 0.5 - 2.0
  tags: string[];
}

export type SituationshipType =
  | "entanglement"
  | "push_pull"
  | "unrequited"
  | "ghosting"
  | "limbo"
  | "soulmate_fusion";

export interface SituationshipDiagnosis {
  type: SituationshipType;
  headline: string;
  dissonanceScore: number; // 0 - 100
  narrativeDiagnosis: string;
  inflictionChoreography: {
    blendMode: "difference" | "exclusion" | "hardlight" | "screen" | "overlay" | "lighten";
    collisionRate: "downbeat" | "bar" | "two_bars" | "half_bar";
    stutterGlitch: boolean;
    hudBadge: string;
    opacityRange: [number, number];
  };
}

export interface VideoInflictionPlan {
  genre: GenreDiagnosis;
  situationship: SituationshipDiagnosis;
  originalSound: boolean;
  videoOnly: boolean;
  diagnosedAt: number;
  model: string;
  source: "gemini" | "heuristic";
}

export interface UserQuotaStatus {
  allowed: boolean;
  userId: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
  resetInMs: number;
  unlimited: boolean;
}

export interface DiagnoseOptions {
  originalSound?: boolean;
  videoOnly?: boolean;
  /** Server managers skip the quota (the Discord command sets this from Manage Server). */
  bypassQuota?: boolean;
}

const SITUATIONSHIPS: SituationshipType[] = ["entanglement", "push_pull", "unrequited", "ghosting", "limbo", "soulmate_fusion"];
const BLEND_MODES: SituationshipDiagnosis["inflictionChoreography"]["blendMode"][] = ["difference", "exclusion", "hardlight", "screen", "overlay", "lighten"];
const COLLISION_RATES: SituationshipDiagnosis["inflictionChoreography"]["collisionRate"][] = ["downbeat", "bar", "two_bars", "half_bar"];

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function formatDuration(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatQuota(status: UserQuotaStatus): string {
  if (status.unlimited) return "unlimited (quota bypass)";
  const resets = status.used ? ` (resets in ${formatDuration(status.resetInMs)})` : "";
  return `${status.remaining}/${status.limit} remaining${resets}`;
}

export interface QuotaStore {
  history(userId: string, since: number): Promise<number[]>;
  reserve(userId: string, at: number, since: number, limit: number): Promise<boolean>;
  release(userId: string, at: number): Promise<void>;
}

export class MemoryQuotaStore implements QuotaStore {
  private usage = new Map<string, number[]>();

  async history(userId: string, since: number): Promise<number[]> {
    return (this.usage.get(userId) ?? []).filter(at => at > since).sort((a, b) => a - b);
  }

  async reserve(userId: string, at: number, since: number, limit: number): Promise<boolean> {
    const history = (this.usage.get(userId) ?? []).filter(timestamp => timestamp > since).sort((a, b) => a - b);
    if (history.length >= limit) {
      this.usage.set(userId, history);
      return false;
    }
    this.usage.set(userId, [...history, at].sort((a, b) => a - b));
    return true;
  }

  async release(userId: string, at: number): Promise<void> {
    const history = this.usage.get(userId) ?? [];
    const index = history.indexOf(at);
    if (index >= 0) history.splice(index, 1);
    if (history.length) this.usage.set(userId, history);
    else this.usage.delete(userId);
  }
}

export class PgQuotaStore implements QuotaStore {
  private schemaReady?: Promise<void>;

  constructor(private pool: Pool) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= (async () => {
      await this.pool.query("CREATE TABLE IF NOT EXISTS studio_quota_usage (id bigserial PRIMARY KEY, user_id text NOT NULL, used_at timestamptz NOT NULL)");
      await this.pool.query("CREATE INDEX IF NOT EXISTS studio_quota_usage_user_time ON studio_quota_usage (user_id, used_at)");
    })();
    return this.schemaReady;
  }

  async history(userId: string, since: number): Promise<number[]> {
    await this.ensureSchema();
    const result = await this.pool.query<{ used_at: number }>(
      "SELECT (extract(epoch from used_at) * 1000)::float8 AS used_at FROM studio_quota_usage WHERE user_id = $1 AND used_at > to_timestamp($2 / 1000.0) ORDER BY used_at",
      [userId, since]
    );
    return result.rows.map(row => Math.round(Number(row.used_at)));
  }

  async reserve(userId: string, at: number, since: number, limit: number): Promise<boolean> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);
      await client.query(
        "DELETE FROM studio_quota_usage WHERE user_id = $1 AND used_at <= to_timestamp($2 / 1000.0)",
        [userId, since]
      );
      const result = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM studio_quota_usage WHERE user_id = $1 AND used_at > to_timestamp($2 / 1000.0)",
        [userId, since]
      );
      const allowed = Number(result.rows[0]?.count ?? 0) < limit;
      if (allowed) {
        await client.query(
          "INSERT INTO studio_quota_usage (user_id, used_at) VALUES ($1, to_timestamp($2 / 1000.0))",
          [userId, at]
        );
      }
      await client.query("COMMIT");
      return allowed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async release(userId: string, at: number): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      "DELETE FROM studio_quota_usage WHERE id = (SELECT id FROM studio_quota_usage WHERE user_id = $1 AND used_at = to_timestamp($2 / 1000.0) LIMIT 1)",
      [userId, at]
    );
  }
}

export function createQuotaStore(env = process.env): QuotaStore {
  return env.DATABASE_URL ? new PgQuotaStore(new Pool({ connectionString: env.DATABASE_URL })) : new MemoryQuotaStore();
}

export class UserQuotaManager {
  private backupStore = new MemoryQuotaStore();
  readonly limit: number;
  readonly windowMs: number;
  private adminUsers: Set<string>;

  constructor(
    limit = 5,
    windowMs = 24 * 60 * 60 * 1000,
    private now: () => number = Date.now,
    private store: QuotaStore = new MemoryQuotaStore()
  ) {
    this.limit = Math.floor(positive(process.env.STUDIO_USER_QUOTA_LIMIT, limit));
    this.windowMs = positive(process.env.STUDIO_USER_QUOTA_WINDOW_MS, windowMs);
    const admins = (process.env.STUDIO_QUOTA_ADMINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    this.adminUsers = new Set(admins);
  }

  private warnStoreFailure(error: unknown): void {
    console.warn(`Studio quota store failed, using in-memory quota: ${error instanceof Error ? error.message : String(error)}`);
  }

  private async history(userId: string, since: number): Promise<number[]> {
    try {
      return await this.store.history(userId, since);
    } catch (error) {
      this.warnStoreFailure(error);
      return this.backupStore.history(userId, since);
    }
  }

  async checkQuota(userId: string, bypass = false): Promise<UserQuotaStatus> {
    const now = this.now();
    if (bypass || this.adminUsers.has(userId)) {
      return { allowed: true, userId, used: 0, limit: this.limit, remaining: this.limit, resetAt: now, resetInMs: 0, unlimited: true };
    }
    const cutoff = now - this.windowMs;
    const usage = await this.history(userId, cutoff);
    const used = usage.length;
    const resetAt = (usage[0] ?? now) + this.windowMs;
    return {
      allowed: used < this.limit,
      userId,
      used,
      limit: this.limit,
      remaining: Math.max(0, this.limit - used),
      resetAt,
      resetInMs: used ? Math.max(0, resetAt - now) : 0,
      unlimited: false
    };
  }

  async reserve(userId: string, bypass = false): Promise<{ allowed: boolean; release: () => Promise<void> }> {
    if (bypass || this.adminUsers.has(userId)) return { allowed: true, release: async () => {} };
    const at = this.now();
    const since = at - this.windowMs;
    let reservationStore = this.store;
    let allowed: boolean;
    try {
      allowed = await this.store.reserve(userId, at, since, this.limit);
    } catch (error) {
      this.warnStoreFailure(error);
      reservationStore = this.backupStore;
      allowed = await this.backupStore.reserve(userId, at, since, this.limit);
    }
    return {
      allowed,
      release: async () => {
        if (!allowed) return;
        try {
          await reservationStore.release(userId, at);
        } catch (error) {
          this.warnStoreFailure(error);
          await this.backupStore.release(userId, at);
        }
      }
    };
  }
}

export class QuotaExceededError extends Error {
  constructor(public quota: UserQuotaStatus) {
    super(`Usage quota reached (${quota.used}/${quota.limit} runs). Window resets in ${formatDuration(quota.resetInMs)}.`);
  }
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const str = (value: unknown, fallback: string, max = 300) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
const strings = (value: unknown, fallback: string[], max = 8) => {
  const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map(v => v.trim().slice(0, 60)) : [];
  return list.length ? list.slice(0, max) : fallback;
};

// Model output is untrusted: keep each valid field and fill anything missing or out of range from the heuristic plan.
export function normalizeDiagnosis(raw: unknown, fallback: VideoInflictionPlan): Pick<VideoInflictionPlan, "genre" | "situationship"> {
  const input = (raw && typeof raw === "object" ? raw : {}) as { genre?: Record<string, unknown>; situationship?: Record<string, unknown> };
  const g = input.genre ?? {};
  const s = input.situationship ?? {};
  const c = (s.inflictionChoreography && typeof s.inflictionChoreography === "object" ? s.inflictionChoreography : {}) as Record<string, unknown>;
  const fg = fallback.genre;
  const fs = fallback.situationship;
  const fc = fs.inflictionChoreography;
  const palette = Array.isArray(g.aestheticPalette) ? g.aestheticPalette.filter((h): h is string => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h)) : [];
  const opacity = Array.isArray(c.opacityRange) ? c.opacityRange : [];
  const lo = clamp(opacity[0], 0.05, 1, fc.opacityRange[0]);
  const hi = clamp(opacity[1], 0.05, 1, fc.opacityRange[1]);
  const headline = str(s.headline, fs.headline, 80);
  const dissonanceScore = Math.round(clamp(s.dissonanceScore, 0, 100, fs.dissonanceScore));
  return {
    genre: {
      primaryGenre: str(g.primaryGenre, fg.primaryGenre, 80),
      subgenres: strings(g.subgenres, fg.subgenres, 5),
      energy: clamp(g.energy, 0, 1, fg.energy),
      aestheticPalette: palette.length >= 2 ? palette.slice(0, 6) : fg.aestheticPalette,
      visualTempoFactor: clamp(g.visualTempoFactor, 0.5, 2, fg.visualTempoFactor),
      tags: strings(g.tags, fg.tags)
    },
    situationship: {
      type: oneOf(s.type, SITUATIONSHIPS, fs.type),
      headline,
      dissonanceScore,
      narrativeDiagnosis: str(s.narrativeDiagnosis, fs.narrativeDiagnosis, 400),
      inflictionChoreography: {
        blendMode: oneOf(c.blendMode, BLEND_MODES, fc.blendMode),
        collisionRate: oneOf(c.collisionRate, COLLISION_RATES, fc.collisionRate),
        stutterGlitch: typeof c.stutterGlitch === "boolean" ? c.stutterGlitch : fc.stutterGlitch,
        hudBadge: str(c.hudBadge, `SITUATIONSHIP: ${headline.toUpperCase()} [${dissonanceScore}% DISSONANCE]`, 90),
        opacityRange: [Math.min(lo, hi), Math.max(lo, hi)]
      }
    }
  };
}

const STRING = { type: "STRING" };
const NUMBER = { type: "NUMBER" };
export const DIAGNOSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    genre: {
      type: "OBJECT",
      properties: {
        primaryGenre: STRING,
        subgenres: { type: "ARRAY", items: STRING },
        energy: NUMBER,
        aestheticPalette: { type: "ARRAY", items: { type: "STRING", description: "#rrggbb" } },
        visualTempoFactor: NUMBER,
        tags: { type: "ARRAY", items: STRING }
      },
      required: ["primaryGenre", "subgenres", "energy", "aestheticPalette", "visualTempoFactor", "tags"]
    },
    situationship: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", enum: SITUATIONSHIPS },
        headline: STRING,
        dissonanceScore: NUMBER,
        narrativeDiagnosis: STRING,
        inflictionChoreography: {
          type: "OBJECT",
          properties: {
            blendMode: { type: "STRING", enum: BLEND_MODES },
            collisionRate: { type: "STRING", enum: COLLISION_RATES },
            stutterGlitch: { type: "BOOLEAN" },
            hudBadge: STRING,
            opacityRange: { type: "ARRAY", items: NUMBER }
          },
          required: ["blendMode", "collisionRate", "stutterGlitch", "hudBadge", "opacityRange"]
        }
      },
      required: ["type", "headline", "dissonanceScore", "narrativeDiagnosis", "inflictionChoreography"]
    }
  },
  required: ["genre", "situationship"]
};

export function diagnosisPrompt(track: TrackAttributes, videoDescriptions?: string[]): string {
  return `You are the director agent for a music video studio with two galaxy light rigs.
Analyze the song and the video descriptions and diagnose:
1. "genre": a sonic/aesthetic genre profile with a 4-colour #rrggbb palette for the light rigs, energy 0-1 and a visual tempo factor 0.5-2.
2. "situationship": the interpersonal/thematic relationship dynamic between the song and the colliding videos (entanglement, push_pull, unrequited, ghosting, limbo or soulmate_fusion), a short headline, a 0-100 dissonance score and a two-sentence narrative diagnosis.
3. "inflictionChoreography": how the videos are inflicted on each other: FFmpeg blend mode, how often they collide (half_bar, downbeat, bar or two_bars), whether to strobe on snare/clap hits, a short HUD badge, and a [low, high] opacity range between 0 and 1.

Song:
- Title: ${track.name}
- Artist: ${track.artist}
- Tags: ${track.tags.join(", ") || "none"}
- Genres: ${track.genres?.join(", ") || "none"}
- BPM: ${track.bpm ?? "unknown"}
- Key: ${track.key ?? "unknown"}
- Danceability: ${track.danceability ?? "unknown"}
- Acousticness: ${track.acousticness ?? "unknown"}
- Summary: ${track.summary?.slice(0, 400) ?? "none"}
Videos: ${videoDescriptions?.filter(Boolean).join(" | ") || "two unnamed video streams colliding"}`;
}

export interface GeminiAgentOptions {
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GeminiStudioAgent {
  public model: string;
  private apiKey: string;
  public quotaManager: UserQuotaManager;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(apiKey?: string, quotaManager?: UserQuotaManager, options: GeminiAgentOptions = {}) {
    this.apiKey = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    this.quotaManager = quotaManager ?? new UserQuotaManager();
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 25000;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  // Only successful Gemini diagnoses use quota; heuristic answers are free.
  async diagnose(
    track: TrackAttributes,
    videoDescriptions?: string[],
    userId = "default",
    options: DiagnoseOptions = {}
  ): Promise<{ diagnosis: VideoInflictionPlan; quota: UserQuotaStatus }> {
    const fallback = this.heuristicDiagnosis(track, videoDescriptions, options);
    if (!this.apiKey) {
      return { diagnosis: fallback, quota: await this.quotaManager.checkQuota(userId, options.bypassQuota) };
    }
    const reservation = await this.quotaManager.reserve(userId, options.bypassQuota);
    if (!reservation.allowed) {
      throw new QuotaExceededError(await this.quotaManager.checkQuota(userId, options.bypassQuota));
    }
    let diagnosis = fallback;
    try {
      diagnosis = { ...fallback, ...normalizeDiagnosis(await this.callGemini(track, videoDescriptions), fallback), source: "gemini" };
    } catch (error) {
      await reservation.release();
      console.warn(`Gemini (${this.model}) diagnosis failed, using heuristic diagnosis:`, error instanceof Error ? error.message : error);
    }
    return { diagnosis, quota: await this.quotaManager.checkQuota(userId, options.bypassQuota) };
  }

  private async callGemini(track: TrackAttributes, videoDescriptions?: string[]): Promise<unknown> {
    const base = (process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const response = await this.fetchImpl(`${base}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: diagnosisPrompt(track, videoDescriptions) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: DIAGNOSIS_SCHEMA, temperature: 0.4 }
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini API returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("").trim();
    if (!text) throw new Error("Empty response from Gemini");
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  }

  public heuristicDiagnosis(
    track: TrackAttributes,
    videoDescriptions?: string[],
    options?: DiagnoseOptions
  ): VideoInflictionPlan {
    const allTags = [...track.tags, ...(track.artistTags ?? []), ...(track.genres ?? [])].map(t => t.toLowerCase());
    const bpm = track.bpm ?? 120;
    const danceability = track.danceability ?? 0.5;

    // Diagnose Genre
    let primary = "Alternative / Electronic";
    let subgenres = ["Indie", "Synth-Wave"];
    let palette = ["#ff3366", "#33ccff", "#9933ff", "#ffffff"];
    let energy = Math.min(1.0, Math.max(0.1, (bpm / 180) * 0.6 + danceability * 0.4));

    if (allTags.some(t => t.includes("metal") || t.includes("rock") || t.includes("punk") || t.includes("grunge"))) {
      primary = "Hard Rock / Post-Punk";
      subgenres = ["Alternative Rock", "Industrial", "Noise"];
      palette = ["#ff1744", "#212121", "#ff9100", "#d50000"];
      energy = 0.9;
    } else if (allTags.some(t => t.includes("hyperpop") || t.includes("glitch") || t.includes("breakcore"))) {
      primary = "Hyperpop / Glitch-Core";
      subgenres = ["Digicore", "Bubblegum Bass", "Glitch"];
      palette = ["#ff007f", "#00f0ff", "#ffe600", "#7928ca"];
      energy = 0.95;
    } else if (allTags.some(t => t.includes("hip hop") || t.includes("rap") || t.includes("trap"))) {
      primary = "Contemporary Hip-Hop / Trap";
      subgenres = ["Trap", "Boom Bap", "Cloud Rap"];
      palette = ["#f5a623", "#4a90e2", "#9013fe", "#50e3c2"];
      energy = 0.8;
    } else if (allTags.some(t => t.includes("ambient") || t.includes("chill") || t.includes("acoustic") || t.includes("folk"))) {
      primary = "Atmospheric Ambient / Indie Folk";
      subgenres = ["Dreampop", "Lo-Fi", "Acoustic"];
      palette = ["#7ed321", "#4990e2", "#b8e986", "#50e3c2"];
      energy = 0.35;
    }

    // Diagnose Situationship
    let type: SituationshipType = "entanglement";
    let headline = "Chaotic Midnight Entanglement";
    let dissonanceScore = 75;
    let narrative = "Both visual threads pull in opposing emotional orbits; neither side yields, creating high-voltage artistic dissonance.";
    let blendMode: SituationshipDiagnosis["inflictionChoreography"]["blendMode"] = "difference";
    let collisionRate: SituationshipDiagnosis["inflictionChoreography"]["collisionRate"] = "downbeat";
    let stutterGlitch = true;

    if (energy > 0.85) {
      type = "entanglement";
      headline = "Toxic High-Energy Entanglement";
      dissonanceScore = 88;
      narrative = "Frenetic tempo and heavy saturation force a violent collision between video feeds on every downbeat.";
      blendMode = "difference";
      collisionRate = "half_bar";
      stutterGlitch = true;
    } else if (allTags.some(t => t.includes("sad") || t.includes("lonely") || t.includes("breakup") || t.includes("melanchol"))) {
      type = "ghosting";
      headline = "Ethereal Ghosting Drift";
      dissonanceScore = 62;
      narrative = "One video channel dissolves into cold translucent obscurity while the other drifts onward.";
      blendMode = "exclusion";
      collisionRate = "two_bars";
      stutterGlitch = false;
    } else if (danceability > 0.7 && energy > 0.6) {
      type = "soulmate_fusion";
      headline = "Kinetic Pulse Fusion";
      dissonanceScore = 24;
      narrative = "Harmonic rhythm locks the visual planes into synchronized dual-layer resonance.";
      blendMode = "screen";
      collisionRate = "bar";
      stutterGlitch = false;
    } else if (bpm < 95) {
      type = "unrequited";
      headline = "Unrequited Satellite Longing";
      dissonanceScore = 70;
      narrative = "A persistent picture-in-picture frame orbits the primary visual space, perpetually out of reach.";
      blendMode = "overlay";
      collisionRate = "bar";
      stutterGlitch = false;
    } else {
      type = "push_pull";
      headline = "Indecisive Push-Pull Limbo";
      dissonanceScore = 68;
      narrative = "Alternating stroboscopic cuts switch visual dominance between bars, highlighting emotional ambivalence.";
      blendMode = "hardlight";
      collisionRate = "bar";
      stutterGlitch = true;
    }

    return {
      genre: {
        primaryGenre: primary,
        subgenres,
        energy,
        aestheticPalette: palette,
        visualTempoFactor: bpm / 120,
        tags: allTags.slice(0, 8)
      },
      situationship: {
        type,
        headline,
        dissonanceScore,
        narrativeDiagnosis: narrative,
        inflictionChoreography: {
          blendMode,
          collisionRate,
          stutterGlitch,
          hudBadge: `SITUATIONSHIP: ${headline.toUpperCase()} [${dissonanceScore}% DISSONANCE]`,
          opacityRange: [0.35, 0.85]
        }
      },
      originalSound: options?.originalSound ?? true,
      videoOnly: options?.videoOnly ?? true,
      diagnosedAt: Date.now(),
      model: this.model,
      source: "heuristic"
    };
  }
}

export const defaultGeminiAgent = new GeminiStudioAgent(undefined, new UserQuotaManager(undefined, undefined, undefined, createQuotaStore()));

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
}

export interface UserQuotaStatus {
  allowed: boolean;
  userId: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
  resetInMs: number;
}

export class UserQuotaManager {
  private userUsage = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;
  private adminUsers: Set<string>;

  constructor(limit = 5, windowMs = 24 * 60 * 60 * 1000) {
    this.limit = Number(process.env.STUDIO_USER_QUOTA_LIMIT ?? limit);
    this.windowMs = Number(process.env.STUDIO_USER_QUOTA_WINDOW_MS ?? windowMs);
    const admins = (process.env.STUDIO_QUOTA_ADMINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    this.adminUsers = new Set(admins);
  }

  checkQuota(userId: string): UserQuotaStatus {
    if (this.adminUsers.has(userId)) {
      return {
        allowed: true,
        userId,
        used: 0,
        limit: Infinity,
        remaining: Infinity,
        resetAt: Date.now(),
        resetInMs: 0
      };
    }
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const history = (this.userUsage.get(userId) ?? []).filter(ts => ts > cutoff);
    this.userUsage.set(userId, history);

    const used = history.length;
    const remaining = Math.max(0, this.limit - used);
    const oldest = history[0] ?? now;
    const resetAt = oldest + this.windowMs;
    const resetInMs = Math.max(0, resetAt - now);

    return {
      allowed: used < this.limit,
      userId,
      used,
      limit: this.limit,
      remaining,
      resetAt,
      resetInMs
    };
  }

  consumeQuota(userId: string): boolean {
    const status = this.checkQuota(userId);
    if (!status.allowed) return false;
    const history = this.userUsage.get(userId) ?? [];
    history.push(Date.now());
    this.userUsage.set(userId, history);
    return true;
  }
}

export class GeminiStudioAgent {
  public model = "gemini-3.8-flash";
  private apiKey: string;
  public quotaManager: UserQuotaManager;

  constructor(apiKey?: string, quotaManager?: UserQuotaManager) {
    this.apiKey = apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
    this.quotaManager = quotaManager ?? new UserQuotaManager();
  }

  async diagnose(
    track: TrackAttributes,
    videoDescriptions?: string[],
    userId = "default",
    options?: { originalSound?: boolean; videoOnly?: boolean }
  ): Promise<{ diagnosis: VideoInflictionPlan; quota: UserQuotaStatus }> {
    const quota = this.quotaManager.checkQuota(userId);
    if (!quota.allowed) {
      const minutes = Math.ceil(quota.resetInMs / 60000);
      throw new Error(`Usage quota reached (${quota.used}/${quota.limit} runs). Window resets in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }

    let plan: VideoInflictionPlan;
    if (this.apiKey) {
      try {
        plan = await this.callGemini(track, videoDescriptions, options);
      } catch (error) {
        console.warn("Gemini 3.8 Flash API diagnosis call failed, using heuristic diagnosis:", error);
        plan = this.heuristicDiagnosis(track, videoDescriptions, options);
      }
    } else {
      plan = this.heuristicDiagnosis(track, videoDescriptions, options);
    }

    this.quotaManager.consumeQuota(userId);
    const updatedQuota = this.quotaManager.checkQuota(userId);
    return { diagnosis: plan, quota: updatedQuota };
  }

  private async callGemini(
    track: TrackAttributes,
    videoDescriptions?: string[],
    options?: { originalSound?: boolean; videoOnly?: boolean }
  ): Promise<VideoInflictionPlan> {
    const prompt = `You are the Gemini 3.8 Flash Director Agent for music video studio rigs.
Analyze the following song and video descriptions to diagnose:
1. "Genre": Detailed sonic/aesthetic genre profile with color palette and visual energy.
2. "Situationships": Interpersonal/thematic relationship dynamic represented by the song and conflicting videos (e.g., "entanglement", "push_pull", "unrequited", "ghosting", "limbo", or "soulmate_fusion").
3. "Infliction Choreography": Specific FFmpeg blend modes and collision parameters for inflicting the videos upon each other.

Song Details:
- Title: ${track.name}
- Artist: ${track.artist}
- Tags: ${track.tags.join(", ") || "none"}
- Genres: ${track.genres?.join(", ") || "none"}
- BPM: ${track.bpm ?? "unknown"}
- Key: ${track.key ?? "unknown"}
- Danceability: ${track.danceability ?? "unknown"}
- Acousticness: ${track.acousticness ?? "unknown"}
- Summary: ${track.summary?.slice(0, 400) ?? "none"}
- Video Descriptions: ${videoDescriptions?.join(" | ") || "Dual video stream collision"}

Return ONLY valid JSON matching this exact structure:
{
  "genre": {
    "primaryGenre": "string",
    "subgenres": ["string"],
    "energy": 0.8,
    "aestheticPalette": ["#hex1", "#hex2", "#hex3", "#hex4"],
    "visualTempoFactor": 1.0,
    "tags": ["string"]
  },
  "situationship": {
    "type": "entanglement",
    "headline": "string",
    "dissonanceScore": 75,
    "narrativeDiagnosis": "string",
    "inflictionChoreography": {
      "blendMode": "difference",
      "collisionRate": "downbeat",
      "stutterGlitch": true,
      "hudBadge": "string",
      "opacityRange": [0.4, 0.9]
    }
  }
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.4
        }
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned HTTP ${response.status}`);
    }

    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty response from Gemini 3.8 Flash");

    const parsed = JSON.parse(text) as {
      genre: GenreDiagnosis;
      situationship: SituationshipDiagnosis;
    };

    return {
      genre: parsed.genre,
      situationship: parsed.situationship,
      originalSound: options?.originalSound ?? true,
      videoOnly: options?.videoOnly ?? true,
      diagnosedAt: Date.now(),
      model: this.model
    };
  }

  public heuristicDiagnosis(
    track: TrackAttributes,
    videoDescriptions?: string[],
    options?: { originalSound?: boolean; videoOnly?: boolean }
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
      model: this.model
    };
  }
}

export const defaultGeminiAgent = new GeminiStudioAgent();

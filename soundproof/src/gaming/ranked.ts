import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_RATING = 1000;
export const K_FACTOR = 32;

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

export function eloUpdate(ra: number, rb: number, scoreA: 1 | 0.5 | 0): { a: number; b: number } {
  const expectedA = expectedScore(ra, rb);
  const expectedB = expectedScore(rb, ra);
  return {
    a: Math.round(ra + K_FACTOR * (scoreA - expectedA)),
    b: Math.round(rb + K_FACTOR * ((1 - scoreA) - expectedB))
  };
}

export const RANK_TIERS = [
  { min: 0, name: "Bronze" },
  { min: 1100, name: "Silver" },
  { min: 1250, name: "Gold" },
  { min: 1400, name: "Platinum" },
  { min: 1550, name: "Diamond" },
  { min: 1700, name: "Grenadier" }
];

export function tierFor(rating: number): string {
  return [...RANK_TIERS].reverse().find(tier => rating >= tier.min)?.name ?? RANK_TIERS[0].name;
}

export interface RankedRecord {
  userId: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string;
}

export interface RatingChange {
  before: number;
  after: number;
  record: RankedRecord;
}

export interface RankedStore {
  get(guildId: string, userId: string): Promise<RankedRecord>;
  recordResult(guildId: string, aId: string, bId: string, scoreA: 1 | 0.5 | 0): Promise<{ a: RatingChange; b: RatingChange }>;
  leaderboard(guildId: string, limit?: number): Promise<RankedRecord[]>;
}

interface RankedFile {
  guilds: Record<string, Record<string, RankedRecord>>;
}

function emptyRecord(userId: string): RankedRecord {
  return {
    userId,
    rating: DEFAULT_RATING,
    wins: 0,
    losses: 0,
    draws: 0,
    updatedAt: new Date().toISOString()
  };
}

function isRankedRecord(value: unknown): value is RankedRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RankedRecord>;
  return typeof record.userId === "string" &&
    typeof record.rating === "number" &&
    typeof record.wins === "number" &&
    typeof record.losses === "number" &&
    typeof record.draws === "number" &&
    typeof record.updatedAt === "string";
}

export class FileRankedStore implements RankedStore {
  private data: RankedFile = { guilds: {} };
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async get(guildId: string, userId: string): Promise<RankedRecord> {
    this.load();
    const existing = this.data.guilds[guildId]?.[userId];
    return existing ? { ...existing } : emptyRecord(userId);
  }

  async recordResult(
    guildId: string,
    aId: string,
    bId: string,
    scoreA: 1 | 0.5 | 0
  ): Promise<{ a: RatingChange; b: RatingChange }> {
    this.load();
    const aBefore = this.data.guilds[guildId]?.[aId] ?? emptyRecord(aId);
    const bBefore = this.data.guilds[guildId]?.[bId] ?? emptyRecord(bId);
    const ratings = eloUpdate(aBefore.rating, bBefore.rating, scoreA);
    const updatedAt = new Date().toISOString();
    const aRecord: RankedRecord = {
      ...aBefore,
      rating: ratings.a,
      wins: aBefore.wins + (scoreA === 1 ? 1 : 0),
      losses: aBefore.losses + (scoreA === 0 ? 1 : 0),
      draws: aBefore.draws + (scoreA === 0.5 ? 1 : 0),
      updatedAt
    };
    const bRecord: RankedRecord = {
      ...bBefore,
      rating: ratings.b,
      wins: bBefore.wins + (scoreA === 0 ? 1 : 0),
      losses: bBefore.losses + (scoreA === 1 ? 1 : 0),
      draws: bBefore.draws + (scoreA === 0.5 ? 1 : 0),
      updatedAt
    };
    this.guild(guildId)[aId] = aRecord;
    this.guild(guildId)[bId] = bRecord;
    this.write();
    return {
      a: { before: aBefore.rating, after: aRecord.rating, record: { ...aRecord } },
      b: { before: bBefore.rating, after: bRecord.rating, record: { ...bRecord } }
    };
  }

  async leaderboard(guildId: string, limit = 10): Promise<RankedRecord[]> {
    this.load();
    if (limit <= 0) return [];
    return Object.values(this.data.guilds[guildId] ?? {})
      .sort((a, b) => b.rating - a.rating)
      .slice(0, Math.max(0, limit))
      .map(record => ({ ...record }));
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RankedFile>;
      if (!parsed.guilds || typeof parsed.guilds !== "object") return;
      const guilds: RankedFile["guilds"] = {};
      for (const [guildId, records] of Object.entries(parsed.guilds)) {
        if (!records || typeof records !== "object") continue;
        guilds[guildId] = {};
        for (const [userId, record] of Object.entries(records)) {
          if (isRankedRecord(record) && record.userId === userId) {
            guilds[guildId][userId] = { ...record };
          }
        }
      }
      this.data = { guilds };
    } catch {
      this.data = { guilds: {} };
    }
  }

  private guild(guildId: string): Record<string, RankedRecord> {
    this.data.guilds[guildId] ??= {};
    return this.data.guilds[guildId];
  }

  private write(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf8");
      renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error("Handball ranked: file write failed", error);
    }
  }
}

export class RedisRankedStore implements RankedStore {
  constructor(private readonly client: any) {}

  async get(guildId: string, userId: string): Promise<RankedRecord> {
    const values = await this.client.hgetall(this.hashKey(guildId, userId));
    if (!values || Object.keys(values).length === 0) return emptyRecord(userId);
    return {
      userId,
      rating: Number(values.rating ?? DEFAULT_RATING),
      wins: Number(values.wins ?? 0),
      losses: Number(values.losses ?? 0),
      draws: Number(values.draws ?? 0),
      updatedAt: values.updatedAt ?? new Date().toISOString()
    };
  }

  async recordResult(
    guildId: string,
    aId: string,
    bId: string,
    scoreA: 1 | 0.5 | 0
  ): Promise<{ a: RatingChange; b: RatingChange }> {
    const [aBefore, bBefore] = await Promise.all([this.get(guildId, aId), this.get(guildId, bId)]);
    const ratings = eloUpdate(aBefore.rating, bBefore.rating, scoreA);
    const updatedAt = new Date().toISOString();
    const aRecord: RankedRecord = {
      ...aBefore,
      rating: ratings.a,
      wins: aBefore.wins + (scoreA === 1 ? 1 : 0),
      losses: aBefore.losses + (scoreA === 0 ? 1 : 0),
      draws: aBefore.draws + (scoreA === 0.5 ? 1 : 0),
      updatedAt
    };
    const bRecord: RankedRecord = {
      ...bBefore,
      rating: ratings.b,
      wins: bBefore.wins + (scoreA === 0 ? 1 : 0),
      losses: bBefore.losses + (scoreA === 1 ? 1 : 0),
      draws: bBefore.draws + (scoreA === 0.5 ? 1 : 0),
      updatedAt
    };
    await Promise.all([
      this.writeRecord(guildId, aRecord),
      this.writeRecord(guildId, bRecord)
    ]);
    return {
      a: { before: aBefore.rating, after: aRecord.rating, record: aRecord },
      b: { before: bBefore.rating, after: bRecord.rating, record: bRecord }
    };
  }

  async leaderboard(guildId: string, limit = 10): Promise<RankedRecord[]> {
    if (limit <= 0) return [];
    const ids = await this.client.zrevrange(this.leaderboardKey(guildId), 0, Math.max(-1, limit - 1));
    return Promise.all(ids.map((userId: string) => this.get(guildId, userId)));
  }

  private async writeRecord(guildId: string, record: RankedRecord): Promise<void> {
    await this.client.hset(this.hashKey(guildId, record.userId), {
      rating: String(record.rating),
      wins: String(record.wins),
      losses: String(record.losses),
      draws: String(record.draws),
      updatedAt: record.updatedAt
    });
    await this.client.zadd(this.leaderboardKey(guildId), String(record.rating), record.userId);
  }

  private hashKey(guildId: string, userId: string): string {
    return `handball:rank:${guildId}:${userId}`;
  }

  private leaderboardKey(guildId: string): string {
    return `handball:lb:${guildId}`;
  }
}

let storePromise: Promise<RankedStore> | undefined;

export function createRankedStore(): Promise<RankedStore> {
  storePromise ??= createStore();
  return storePromise;
}

async function createStore(): Promise<RankedStore> {
  const url = process.env.REDIS_URL;
  if (url) {
    let client: any;
    try {
      const { Redis } = require("ioredis") as { Redis: new (url: string, opts?: object) => any };
      client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        ...(url.startsWith("rediss://") ? { tls: {} } : {})
      });
      await client.connect();
      await client.ping();
      return new RedisRankedStore(client);
    } catch (error) {
      try {
        client?.disconnect();
      } catch {}
      console.error("Handball ranked: Redis unavailable, using file backend", error);
    }
  }
  return new FileRankedStore(process.env.HANDBALL_DATA_PATH ?? path.join("data", "handball-ranked.json"));
}

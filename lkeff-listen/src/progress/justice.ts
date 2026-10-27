// Uniform Code of Gaming Justice (UCGJ) — anti-XP-abuse adjudication.
//
// Prevents XP looting: slash-command spam, repeated-action farming, cross-bot
// "unload" dumps, and daily-cap violations. Escalation is military-justice
// flavored: warning -> Article 15 (half XP rations) -> confinement (24h
// award suspension). Verdicts are computed against a small KV abstraction so
// the same policy works on Redis (shared across bots) or in-memory state.

export interface JusticeKv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Atomically increment by `amount`; applies `ttlMs` only on first write. Returns new value. */
  incr(key: string, amount: number, ttlMs?: number): Promise<number>;
  /** Set only if absent, expiring after `ttlMs`. Returns true when the marker was set. */
  setNx(key: string, ttlMs: number): Promise<boolean>;
  /** Milliseconds until key expiry; negative when unset or already expired. */
  pttl(key: string): Promise<number>;
}

export type Penalty = "none" | "warning" | "article15" | "confinement";

export interface JusticeVerdict {
  awarded: boolean;
  xp: number;
  penalty: Penalty;
  reason?: string;
  /** Set when this request pushed the offender into a new penalty level. */
  escalatedTo?: Penalty;
}

export interface JusticeContext {
  guildId: string;
  userId: string;
  action: string;
  xp: number;
}

export interface JusticePolicy {
  actionCooldownMs: number;
  /** Per-action cooldown overrides (ms) for cheap/farmable actions. */
  actionCooldowns: Record<string, number>;
  velocityMax: number;
  velocityWindowMs: number;
  dailyCap: number;
  article15Strikes: number;
  confinementStrikes: number;
  confinementMs: number;
  offenseWindowMs: number;
}

const envNum = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export function loadPolicy(overrides: Partial<JusticePolicy> = {}): JusticePolicy {
  return {
    actionCooldownMs: envNum("XP_ACTION_COOLDOWN_SEC", 60) * 1000,
    actionCooldowns: {
      help: 300_000,
      progress: 180_000,
      bertcase: 30_000,
      airhorn: 30_000,
      ...overrides.actionCooldowns,
    },
    velocityMax: envNum("XP_VELOCITY_MAX", 12),
    velocityWindowMs: envNum("XP_VELOCITY_WINDOW_SEC", 300) * 1000,
    dailyCap: envNum("XP_DAILY_CAP", 400),
    article15Strikes: envNum("XP_ARTICLE15_STRIKES", 3),
    confinementStrikes: envNum("XP_STRIKE_LIMIT", 5),
    confinementMs: envNum("XP_CONFINEMENT_HOURS", 24) * 3_600_000,
    offenseWindowMs: envNum("XP_OFFENSE_WINDOW_HOURS", 24) * 3_600_000,
    ...overrides,
  };
}

const DAY_MS = 86_400_000;
const key = (part: string, guildId: string, userId: string) => `progress:ucgj:${part}:${guildId}:${userId}`;

async function recordOffense(kv: JusticeKv, guildId: string, userId: string, policy: JusticePolicy): Promise<JusticeVerdict> {
  const offenses = await kv.incr(key("off", guildId, userId), 1, policy.offenseWindowMs);
  const penalty: Penalty =
    offenses >= policy.confinementStrikes ? "confinement" : offenses >= policy.article15Strikes ? "article15" : "warning";
  const verdict: JusticeVerdict = { awarded: false, xp: 0, penalty, reason: "xp-award-denied" };
  if (offenses === policy.article15Strikes) {
    verdict.escalatedTo = "article15";
  } else if (offenses === policy.confinementStrikes) {
    await kv.set(key("conf", guildId, userId), String(Date.now() + policy.confinementMs), policy.confinementMs);
    verdict.escalatedTo = "confinement";
  }
  return verdict;
}

export async function adjudicate(
  kv: JusticeKv,
  ctx: JusticeContext,
  overrides: Partial<JusticePolicy> = {}
): Promise<JusticeVerdict> {
  const policy = loadPolicy(overrides);
  const { guildId, userId, action, xp } = ctx;

  const confined = await kv.get(key("conf", guildId, userId));
  if (confined) {
    return { awarded: false, xp: 0, penalty: "confinement", reason: "XP awards suspended under UCGJ confinement" };
  }

  const dayKey = key(`day:${new Date().toISOString().slice(0, 10)}`, guildId, userId);
  const dailySoFar = Number((await kv.get(dayKey)) ?? "0");
  if (dailySoFar >= policy.dailyCap) {
    const verdict = await recordOffense(kv, guildId, userId, policy);
    verdict.reason = `Daily XP cap (${policy.dailyCap}) reached`;
    return verdict;
  }

  const cooldownMs = policy.actionCooldowns[action] ?? policy.actionCooldownMs;
  if (!(await kv.setNx(key(`cd:${action}`, guildId, userId), cooldownMs))) {
    const verdict = await recordOffense(kv, guildId, userId, policy);
    verdict.reason = `Action /${action} is on cooldown`;
    return verdict;
  }

  const velocity = await kv.incr(key("vel", guildId, userId), 1, policy.velocityWindowMs);
  if (velocity > policy.velocityMax) {
    const verdict = await recordOffense(kv, guildId, userId, policy);
    verdict.reason = `Velocity limit exceeded (${policy.velocityMax} awards per ${policy.velocityWindowMs / 1000}s)`;
    return verdict;
  }

  let awarded = Math.min(xp, policy.dailyCap - dailySoFar);
  const offenses = Number((await kv.get(key("off", guildId, userId))) ?? "0");
  const penalty: Penalty = offenses >= policy.article15Strikes ? "article15" : "none";
  if (penalty === "article15") {
    awarded = Math.max(1, Math.floor(awarded / 2));
  }
  await kv.incr(dayKey, awarded, DAY_MS * 2);
  return { awarded: true, xp: awarded, penalty };
}

export interface ServiceRecord {
  offenses: number;
  penalty: Penalty;
  confinedUntil?: number;
}

export async function getServiceRecord(
  kv: JusticeKv,
  guildId: string,
  userId: string,
  overrides: Partial<JusticePolicy> = {}
): Promise<ServiceRecord> {
  const policy = loadPolicy(overrides);
  const offenses = Number((await kv.get(key("off", guildId, userId))) ?? "0");
  const confTtl = await kv.pttl(key("conf", guildId, userId));
  const penalty: Penalty =
    confTtl > 0 ? "confinement" : offenses >= policy.article15Strikes ? "article15" : offenses > 0 ? "warning" : "none";
  return { offenses, penalty, ...(confTtl > 0 ? { confinedUntil: Date.now() + confTtl } : {}) };
}

/** In-memory KV for the file backend (per-process; resets on restart). */
export function createMemoryKv(): JusticeKv {
  const entries = new Map<string, { value: string; expiresAt?: number }>();
  const read = (k: string): string | null => {
    const entry = entries.get(k);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      entries.delete(k);
      return null;
    }
    return entry.value;
  };
  const write = (k: string, value: string, ttlMs?: number) =>
    entries.set(k, { value, ...(ttlMs !== undefined ? { expiresAt: Date.now() + ttlMs } : {}) });
  return {
    get: async (k) => read(k),
    set: async (k, v, ttlMs) => {
      write(k, v, ttlMs);
    },
    incr: async (k, amount, ttlMs) => {
      const next = Number(read(k) ?? "0") + amount;
      const existing = entries.get(k);
      write(k, String(next), existing?.expiresAt !== undefined ? undefined : ttlMs);
      if (existing?.expiresAt !== undefined) entries.get(k)!.expiresAt = existing.expiresAt;
      return next;
    },
    setNx: async (k, ttlMs) => {
      if (read(k) !== null) return false;
      write(k, "1", ttlMs);
      return true;
    },
    pttl: async (k) => {
      const entry = entries.get(k);
      if (!entry || entry.expiresAt === undefined) return read(k) === null ? -1 : -1;
      return entry.expiresAt - Date.now();
    },
  };
}

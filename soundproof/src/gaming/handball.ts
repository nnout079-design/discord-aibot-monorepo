export type Zone = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export const ZONES: Zone[] = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
export const MAX_COOK_SECONDS = 4;
export const FUSE_MIN_SECONDS = 2.5;
export const FUSE_MAX_SECONDS = 5.0;

export interface ThrowOutcome {
  result: "goal" | "saved" | "wide" | "exploded";
  aim: Zone;
  block: Zone;
  cook: number;
  fuse: number;
  saveChance: number;
}

export function resolveThrow(aim: Zone, block: Zone, cook: number, rng: () => number = Math.random): ThrowOutcome {
  const cooked = Number.isFinite(cook) ? Math.max(0, Math.min(MAX_COOK_SECONDS, Math.trunc(cook))) : 0;
  const fuse = FUSE_MIN_SECONDS + rng() * (FUSE_MAX_SECONDS - FUSE_MIN_SECONDS);
  const saveChance = block === aim ? Math.max(0.15, 0.85 - 0.2 * cooked) : 0;

  if (cooked >= fuse) {
    return { result: "exploded", aim, block, cook: cooked, fuse, saveChance };
  }

  const wideChance = aim === "center" ? 0 : 0.12;
  if (rng() < wideChance) {
    return { result: "wide", aim, block, cook: cooked, fuse, saveChance };
  }

  if (block === aim && rng() < saveChance) {
    return { result: "saved", aim, block, cook: cooked, fuse, saveChance };
  }

  return { result: "goal", aim, block, cook: cooked, fuse, saveChance };
}

export type MatchStatus = "pending" | "active" | "finished" | "declined" | "expired" | "forfeited";

export interface ThrowRecord extends ThrowOutcome {
  throwerId: string;
  keeperId: string;
}

export interface HandballMatch {
  id: string;
  guildId: string;
  channelId: string;
  players: [string, string];
  throwsPerPlayer: number;
  score: [number, number];
  throwsTaken: [number, number];
  turn: 0 | 1;
  pendingBlock?: Zone;
  status: MatchStatus;
  createdAt: number;
  updatedAt: number;
  log: ThrowRecord[];
  forfeitedBy?: string;
}

export interface MatchResult {
  match: HandballMatch;
  winnerId: string | null;
  loserId: string | null;
  draw: boolean;
}

type Ok<T> = { ok: true; value: T } | { ok: false; error: string };

const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVE_TIMEOUT_MS = 15 * 60 * 1000;

function copyMatch(match: HandballMatch): HandballMatch {
  return {
    ...match,
    players: [...match.players],
    score: [...match.score],
    throwsTaken: [...match.throwsTaken],
    log: match.log.map(record => ({ ...record }))
  };
}

function resultFor(match: HandballMatch): MatchResult {
  const [aScore, bScore] = match.score;
  const draw = aScore === bScore;
  return {
    match: copyMatch(match),
    winnerId: draw ? null : match.players[aScore > bScore ? 0 : 1],
    loserId: draw ? null : match.players[aScore > bScore ? 1 : 0],
    draw
  };
}

export class HandballGame {
  private readonly matches = new Map<string, HandballMatch>();
  private nextId = 1;

  createChallenge(
    guildId: string,
    channelId: string,
    challengerId: string,
    opponentId: string,
    throwsPerPlayer = 5,
    now = Date.now()
  ): Ok<HandballMatch> {
    this.expireStale(now);

    if (challengerId === opponentId) {
      return { ok: false, error: "You cannot challenge yourself." };
    }
    if (!Number.isInteger(throwsPerPlayer) || throwsPerPlayer < 3 || throwsPerPlayer > 10) {
      return { ok: false, error: "Throws per player must be between 3 and 10." };
    }
    if (this.hasOpenMatch(guildId, challengerId) || this.hasOpenMatch(guildId, opponentId)) {
      return { ok: false, error: "Either player is already in an open match in this server." };
    }

    const match: HandballMatch = {
      id: `handball-${now}-${this.nextId++}`,
      guildId,
      channelId,
      players: [challengerId, opponentId],
      throwsPerPlayer,
      score: [0, 0],
      throwsTaken: [0, 0],
      turn: 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      log: []
    };
    this.matches.set(match.id, match);
    return { ok: true, value: copyMatch(match) };
  }

  acceptChallenge(guildId: string, userId: string, now = Date.now()): Ok<HandballMatch> {
    this.expireStale(now);
    const match = this.findOpenForUser(guildId, userId);
    if (!match || match.status !== "pending") {
      return { ok: false, error: "There is no pending handball challenge for you in this server." };
    }
    if (match.players[1] !== userId) {
      return { ok: false, error: "Only the challenged player can accept this challenge." };
    }

    match.status = "active";
    match.turn = 0;
    match.updatedAt = now;
    return { ok: true, value: copyMatch(match) };
  }

  declineChallenge(guildId: string, userId: string, now = Date.now()): Ok<HandballMatch> {
    this.expireStale(now);
    const match = this.findOpenForUser(guildId, userId);
    if (!match || match.status !== "pending") {
      return { ok: false, error: "There is no pending handball challenge to decline in this server." };
    }
    match.status = "declined";
    match.updatedAt = now;
    return { ok: true, value: copyMatch(match) };
  }

  setBlock(guildId: string, keeperId: string, zone: Zone, now = Date.now()): Ok<HandballMatch> {
    const match = this.findOpenForUser(guildId, keeperId);
    if (!match || match.status !== "active") {
      return { ok: false, error: "There is no active handball match for you in this server." };
    }
    const keeperIndex = match.players.indexOf(keeperId);
    if (keeperIndex === match.turn) {
      return { ok: false, error: "You are throwing now and cannot set the keeper's block." };
    }
    match.pendingBlock = zone;
    match.updatedAt = now;
    return { ok: true, value: copyMatch(match) };
  }

  takeThrow(
    guildId: string,
    throwerId: string,
    aim: Zone,
    cook: number,
    rng: () => number = Math.random,
    now = Date.now()
  ): Ok<{ outcome: ThrowRecord; match: HandballMatch; result?: MatchResult }> {
    const match = this.findOpenForUser(guildId, throwerId);
    if (!match || match.status !== "active") {
      return { ok: false, error: "There is no active handball match for you in this server." };
    }
    if (match.players[match.turn] !== throwerId) {
      return { ok: false, error: "It is not your turn to throw." };
    }

    const throwerIndex = match.turn;
    const keeperIndex = throwerIndex === 0 ? 1 : 0;
    const thrower = match.players[throwerIndex];
    const keeper = match.players[keeperIndex];
    const outcome = {
      ...resolveThrow(aim, match.pendingBlock ?? "center", cook, rng),
      throwerId: thrower,
      keeperId: keeper
    };

    if (outcome.result === "goal") match.score[throwerIndex] += 1;
    if (outcome.result === "exploded") match.score[keeperIndex] += 1;
    match.log.push(outcome);
    match.throwsTaken[throwerIndex] += 1;
    match.pendingBlock = undefined;
    match.turn = keeperIndex;
    match.updatedAt = now;

    let result: MatchResult | undefined;
    if (match.throwsTaken[0] === match.throwsPerPlayer && match.throwsTaken[1] === match.throwsPerPlayer) {
      match.status = "finished";
      result = resultFor(match);
    }

    return {
      ok: true,
      value: {
        outcome: { ...outcome },
        match: copyMatch(match),
        ...(result ? { result } : {})
      }
    };
  }

  forfeit(guildId: string, userId: string, now = Date.now()): Ok<MatchResult> {
    const match = this.findOpenForUser(guildId, userId);
    if (!match || match.status !== "active") {
      return { ok: false, error: "There is no active handball match to forfeit in this server." };
    }
    match.status = "forfeited";
    match.forfeitedBy = userId;
    match.updatedAt = now;
    return {
      ok: true,
      value: {
        match: copyMatch(match),
        winnerId: match.players.find(playerId => playerId !== userId) ?? null,
        loserId: userId,
        draw: false
      }
    };
  }

  findMatch(guildId: string, userId: string): HandballMatch | undefined {
    this.expireStale();
    const match = this.findOpenForUser(guildId, userId);
    return match ? copyMatch(match) : undefined;
  }

  expireStale(now = Date.now()): HandballMatch[] {
    const expired: HandballMatch[] = [];
    for (const match of this.matches.values()) {
      if (match.status !== "pending" && match.status !== "active") continue;
      const timeout = match.status === "pending" ? PENDING_TIMEOUT_MS : ACTIVE_TIMEOUT_MS;
      if (now - match.updatedAt > timeout) {
        match.status = "expired";
        match.updatedAt = now;
        expired.push(copyMatch(match));
      }
    }
    return expired;
  }

  private hasOpenMatch(guildId: string, userId: string): boolean {
    return this.findOpenForUser(guildId, userId) !== undefined;
  }

  private findOpenForUser(guildId: string, userId: string): HandballMatch | undefined {
    return [...this.matches.values()].find(match =>
      match.guildId === guildId &&
      (match.status === "pending" || match.status === "active") &&
      match.players.includes(userId)
    );
  }
}

export const handballGame = new HandballGame();

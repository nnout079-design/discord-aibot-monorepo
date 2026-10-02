export type GamePhase = "lobby" | "match" | "victory" | "defeat" | "unknown";

export interface GameTelemetry {
  guildId: string;
  channelId: string;
  game: string;
  phase: GamePhase;
  event: string;
  players?: number;
  analysis?: string;
  observedAt: string;
}

export interface GameState extends GameTelemetry {
  updatedAt: string;
}

const states = new Map<string, GameState>();

export function updateGameState(telemetry: GameTelemetry): GameState {
  const state: GameState = { ...telemetry, updatedAt: new Date().toISOString() };
  states.set(telemetry.guildId, state);
  return state;
}

export function getGameState(guildId: string): GameState | undefined {
  return states.get(guildId);
}

export function normalizeTelemetry(input: Partial<GameTelemetry>): GameTelemetry | undefined {
  if (!input.guildId || !input.channelId || !input.game || !input.event) return undefined;
  const phase = input.phase && ["lobby", "match", "victory", "defeat"].includes(input.phase)
    ? input.phase
    : "unknown";
  return {
    guildId: input.guildId,
    channelId: input.channelId,
    game: input.game.trim().toLowerCase(),
    phase: phase as GamePhase,
    event: input.event.trim().toLowerCase(),
    players: input.players,
    analysis: input.analysis,
    observedAt: input.observedAt ?? new Date().toISOString()
  };
}

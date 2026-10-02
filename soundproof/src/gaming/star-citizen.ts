import { GamePhase, GameTelemetry } from "./game-state";

export interface StarCitizenStatus {
  game: "star citizen";
  phase: GamePhase;
  event: string;
  players?: number;
  location?: string;
  ship?: string;
  raw: unknown;
}

function asPhase(value: unknown): GamePhase {
  const phase = String(value ?? "unknown").toLowerCase();
  return ["lobby", "match", "victory", "defeat"].includes(phase) ? phase as GamePhase : "unknown";
}

export async function fetchStarCitizenStatus(): Promise<StarCitizenStatus> {
  const apiKey = process.env.STAR_CITIZEN_API_KEY;
  const apiUrl = process.env.STAR_CITIZEN_API_URL;
  if (!apiKey || !apiUrl) {
    throw new Error("STAR_CITIZEN_API_KEY and STAR_CITIZEN_API_URL must be configured");
  }

  const response = await fetch(apiUrl, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, "x-api-key": apiKey }
  });
  if (!response.ok) throw new Error(`Star Citizen API returned ${response.status}`);

  const raw = await response.json() as Record<string, unknown>;
  return {
    game: "star citizen",
    phase: asPhase(raw.phase ?? raw.state),
    event: String(raw.event ?? raw.activity ?? raw.status ?? "status-update").toLowerCase(),
    players: typeof raw.players === "number" ? raw.players : undefined,
    location: typeof raw.location === "string" ? raw.location : undefined,
    ship: typeof raw.ship === "string" ? raw.ship : undefined,
    raw
  };
}

export async function fetchStarCitizenTelemetry(guildId: string, channelId: string): Promise<GameTelemetry> {
  const status = await fetchStarCitizenStatus();
  const details = [status.location && `location: ${status.location}`, status.ship && `ship: ${status.ship}`]
    .filter(Boolean)
    .join(", ");
  return {
    guildId,
    channelId,
    game: status.game,
    phase: status.phase,
    event: status.event,
    players: status.players,
    analysis: details,
    observedAt: new Date().toISOString()
  };
}

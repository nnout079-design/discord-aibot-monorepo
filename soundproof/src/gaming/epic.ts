const epicClientId = process.env.EPIC_CLIENT_ID ?? process.env.epic_client_id;
const epicClientSecret = process.env.EPIC_CLIENT_SECRET ?? process.env.epic_client_secret;

export interface EpicGameLink {
  game: string;
  launchUri: string;
  configured: boolean;
}

export function detectGameFromText(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.includes("fortnite")) return "fortnite";
  if (normalized.includes("rocket league") || normalized.includes("rocketleague")) return "rocket league";
  if (normalized.includes("grand theft auto") || normalized.includes("gta v") || normalized.includes("gta 5") || normalized.includes("los santos")) return "grand theft auto v";
  return "unknown";
}

export function getEpicGameLink(game: string): EpicGameLink {
  const normalizedGame = game.trim();
  return {
    game: normalizedGame,
    launchUri: `com.epicgames.launcher://apps/${encodeURIComponent(normalizedGame)}?action=launch&silent=true`,
    configured: Boolean(epicClientId && epicClientSecret)
  };
}

export function epicConfigurationStatus(): string {
  return epicClientId && epicClientSecret
    ? "Epic client credentials are configured."
    : "Epic client credentials are not configured.";
}
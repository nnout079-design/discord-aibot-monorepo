import { GameState } from "./game-state";

export interface GameRule {
  id: string;
  games: string[];
  phases?: string[];
  events?: string[];
  keywords?: string[];
  response: string;
  cooldownSeconds: number;
}

export interface GameReaction {
  ruleId: string;
  content: string;
  channelId: string;
}

const rules: GameRule[] = [
  {
    id: "star-citizen-status",
    games: ["star citizen"],
    events: ["status-update", "travel", "combat", "mission", "docking", "quantum"],
    response: "Star Citizen telemetry updated. Keep the flight channel clear for the next event.",
    cooldownSeconds: 60
  },
  {
    id: "fortnite-match-start",
    games: ["fortnite", "fortnite battle royale"],
    phases: ["match"],
    events: ["match-start", "drop", "landing"],
    response: "Match detected. Keep comms clear and watch the first rotation.",
    cooldownSeconds: 60
  },
  {
    id: "fortnite-victory",
    games: ["fortnite", "fortnite battle royale"],
    phases: ["victory"],
    response: "Victory state detected. Nice work, squad.",
    cooldownSeconds: 30
  },
  {
    id: "rocket-league-goal",
    games: ["rocket league", "rocketleague"],
    events: ["goal", "score"],
    response: "Goal detected. Reset positions and prepare for kickoff.",
    cooldownSeconds: 15
  },
  {
    id: "gta-wasted",
    games: ["grand theft auto v"],
    keywords: ["wasted", "you died", "busted"],
    response: "Wasted/busted detected. Give it a beat before respawning.",
    cooldownSeconds: 30
  },
  {
    id: "gta-wanted-level",
    games: ["grand theft auto v"],
    keywords: ["wanted level", "star rating", "police chasing", "cops are"],
    response: "Wanted level spike detected. Lose the heat before the next objective.",
    cooldownSeconds: 45
  },
  {
    id: "gta-mission-start",
    games: ["grand theft auto v"],
    phases: ["match"],
    keywords: ["mission start", "objective", "heist"],
    response: "Mission/heist in progress. Keep comms clear for callouts.",
    cooldownSeconds: 60
  },
  {
    id: "generic-defeat",
    games: ["*"],
    phases: ["defeat"],
    response: "Defeat state detected. Review the last play before queueing again.",
    cooldownSeconds: 30
  },
  {
    id: "generic-gameplay",
    games: ["*"],
    keywords: ["gameplay", "match", "combat", "loading into"],
    response: "Gameplay detected. I am tracking the current session.",
    cooldownSeconds: 120
  }
];

const lastReaction = new Map<string, number>();

export function listRules(): GameRule[] {
  return rules.map(rule => ({ ...rule, games: [...rule.games] }));
}

export function evaluateGameRules(state: GameState): GameReaction | undefined {
  const text = `${state.event} ${state.analysis ?? ""}`.toLowerCase();
  const now = Date.now();
  for (const rule of rules) {
    const gameMatches = rule.games.includes("*") || rule.games.some(game => state.game.includes(game));
    const phaseMatches = !rule.phases || rule.phases.includes(state.phase);
    const eventMatches = !rule.events || rule.events.some(event => state.event.includes(event));
    const keywordMatches = !rule.keywords || rule.keywords.some(keyword => text.includes(keyword));
    const last = lastReaction.get(`${state.guildId}:${rule.id}`) ?? 0;
    if (gameMatches && phaseMatches && eventMatches && keywordMatches && now - last >= rule.cooldownSeconds * 1000) {
      lastReaction.set(`${state.guildId}:${rule.id}`, now);
      return { ruleId: rule.id, content: rule.response, channelId: state.channelId };
    }
  }
  return undefined;
}
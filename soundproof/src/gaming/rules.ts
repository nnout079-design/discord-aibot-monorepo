import { GameState } from "./game-state";
import { recordGuildEvent } from "../progress/tracker";

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
    id: "handball-world-grenade",
    games: ["handball world"],
    events: ["grenade", "throw"],
    response: "Grenade throw detected. Watch the fuse — cook it too long and it goes off in hand.",
    cooldownSeconds: 20
  },
  {
    id: "handball-world-ranked-start",
    games: ["handball world"],
    phases: ["match"],
    keywords: ["ranked"],
    response: "Ranked Handball World match live. Read the keeper and save your long cooks for the last throws.",
    cooldownSeconds: 60
  },
  {
    id: "handball-world-victory",
    games: ["handball world"],
    phases: ["victory"],
    response: "Handball World victory. Ranked points incoming.",
    cooldownSeconds: 30
  },
  {
    id: "stealth-shootout",
    games: ["*"],
    events: ["shootout", "firefight", "gunfight"],
    response: "Shootout detected — get out of the light, break line of sight and run full camouflage in the shadows.",
    cooldownSeconds: 45
  },
  {
    id: "stealth-shoot-out-light",
    games: ["*"],
    events: ["stealth-plan"],
    keywords: ["shoot out"],
    response: "Stealth circuit: shooting out the light — relocate right after, the shot gives away your position.",
    cooldownSeconds: 30
  },
  {
    id: "stealth-high-exposure",
    games: ["*"],
    events: ["stealth-plan"],
    keywords: ["risk high"],
    response: "Stealth circuit: you're lit up and easy to target. Leave the light source and get into dark cover now.",
    cooldownSeconds: 30
  },
  {
    id: "stealth-plan",
    games: ["*"],
    events: ["stealth-plan"],
    response: "Stealth circuit updated: stay out of light sources and hold full camouflage.",
    cooldownSeconds: 60
  },
  {
    id: "vehicle-siren",
    games: ["*"],
    events: ["vehicle-noise"],
    keywords: ["siren", "emergency", "police", "ambulance", "fire engine"],
    response: "Emergency vehicle audio detected. Expect pursuit or response gameplay.",
    cooldownSeconds: 60
  },
  {
    id: "vehicle-aircraft",
    games: ["*"],
    events: ["vehicle-noise"],
    keywords: ["aircraft", "airplane", "helicopter", "jet", "propeller"],
    response: "Aircraft noise detected. Watch the sky for flyovers or drops.",
    cooldownSeconds: 60
  },
  {
    id: "vehicle-horn",
    games: ["*"],
    events: ["vehicle-noise"],
    keywords: ["horn", "toot", "car alarm"],
    response: "Vehicle horn/alarm detected on stream.",
    cooldownSeconds: 45
  },
  {
    id: "vehicle-engine",
    games: ["*"],
    events: ["vehicle-noise"],
    keywords: ["engine", "revving", "vroom", "accelerating", "idling", "race car", "auto racing"],
    response: "Engine noise detected. Sounds like driving or racing action.",
    cooldownSeconds: 60
  },
  {
    id: "vehicle-generic",
    games: ["*"],
    events: ["vehicle-noise"],
    response: "Vehicle noise detected in the audio feed.",
    cooldownSeconds: 90
  },
  {
    id: "threat-drone",
    games: ["*"],
    keywords: ["drone", "uav", "quadcopter", "rotorcraft", "surveillance drone", "aerial drone", "buzzing drone"],
    response: "Drone detected on stream. Stay in cover and watch the sky.",
    cooldownSeconds: 60
  },
  {
    id: "threat-ai-unit",
    games: ["*"],
    keywords: ["enemy npc", "ai enemy", "enemy bot", "hostile robot", "mech", "sentry", "auto-turret", "autonomous", "hunter-killer"],
    response: "AI-controlled hostile detected. Expect patrol patterns rather than human behavior.",
    cooldownSeconds: 90
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
      recordGuildEvent(state.guildId, rule.id, `${state.game}: ${rule.response}`);
      return { ruleId: rule.id, content: rule.response, channelId: state.channelId };
    }
  }
  return undefined;
}
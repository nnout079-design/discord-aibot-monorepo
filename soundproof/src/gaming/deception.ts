import { normalizeTelemetry, updateGameState, getGameState } from "./game-state";
import { evaluateGameRules, GameReaction } from "./rules";
import { analyzeDeath, recordDiagnostic } from "./diagnostics";

export type DeceptionCategory = "draw-fire" | "lure" | "feint" | "mimicry" | "audio-bait" | "information";

export interface DeceptionTactic {
  id: string;
  name: string;
  category: DeceptionCategory;
  description: string;
  execution: string;
  risk: string;
  countersBait: boolean;
}

export const DECEPTION_TACTICS: DeceptionTactic[] = [
  {
    id: "peek-and-hide",
    name: "Peek and hide",
    category: "draw-fire",
    description: "Briefly expose a shoulder or vehicle edge to draw enemy fire, then hold hard cover.",
    execution: "Peek for under a second, return to cover, note the direction of incoming fire.",
    risk: "Skilled opponents pre-aim common peek angles; vary the spot.",
    countersBait: false,
  },
  {
    id: "decoy-shot",
    name: "Decoy shot",
    category: "draw-fire",
    description: "Fire a deliberate shot from a position you immediately vacate, pulling enemy attention and aim.",
    execution: "Fire once, relocate on a concealed route, engage from the new angle.",
    risk: "Works once per opponent; repeat use reveals the pattern.",
    countersBait: false,
  },
  {
    id: "suppressive-dummy",
    name: "Suppressive dummy fire",
    category: "draw-fire",
    description: "Sustained fire on a flank nobody holds, convincing the enemy the push comes from there.",
    execution: "Fire in bursts at a flank for 5-10 seconds while the real element moves elsewhere.",
    risk: "Burns ammo; patient enemies check the quiet flank.",
    countersBait: false,
  },
  {
    id: "wounded-prey",
    name: "Wounded prey",
    category: "lure",
    description: "Feign weakness or retreat to provoke a chase into a prepared ambush.",
    execution: "Retreat loudly toward the kill zone; the pursuing enemy rounds the corner into the squad.",
    risk: "A real chase may arrive faster than the ambush is ready.",
    countersBait: false,
  },
  {
    id: "bait-drop",
    name: "Bait drop",
    category: "lure",
    description: "Leave attractive loot or an objective visible in a covered sightline to lure looters.",
    execution: "Place the bait where your overwatch covers it; wait for the enemy to commit to it.",
    risk: "Some enemies take the loot and leave; the window is short.",
    countersBait: false,
  },
  {
    id: "false-opening",
    name: "False opening",
    category: "lure",
    description: "Deliberately leave an approach unguarded so the enemy funnels into it.",
    execution: "Watch the gap from a flanking position; collapse once the enemy commits.",
    risk: "If unread, the gap is simply open.",
    countersBait: false,
  },
  {
    id: "feint-push",
    name: "Feint push",
    category: "feint",
    description: "Present a committed attack on one axis, then hit a different axis with the real force.",
    execution: "Show vehicles/numbers on axis A for a few seconds, then commit on axis B.",
    risk: "Costs tempo; a passive enemy may ignore it.",
    countersBait: false,
  },
  {
    id: "double-feint",
    name: "Double feint",
    category: "feint",
    description: "Feint twice on the same axis so the third look — which is real — reads as another fake.",
    execution: "Twice show then withdraw on axis A; on the third approach, commit fully.",
    risk: "Slow; only works against opponents tracking patterns.",
    countersBait: false,
  },
  {
    id: "fake-rotation",
    name: "Fake rotation",
    category: "feint",
    description: "Simulate a reposition (engine noise, dust, visible movement) while holding the original position.",
    execution: "Make rotation noise toward B, settle back into cover at A, ambush the flanking enemy.",
    risk: "Requires the enemy to react to your information, not their own recon.",
    countersBait: false,
  },
  {
    id: "skin-mirror",
    name: "Skin mirror",
    category: "mimicry",
    description: "Match opponent appearance, livery, or loadout silhouettes so visual identification is slow.",
    execution: "Mirror the enemy's skin/vehicle paint before contact; exploit the hesitation window.",
    risk: "Friend-or-foe confusion cuts both ways — mark your own squad clearly.",
    countersBait: true,
  },
  {
    id: "terrain-match",
    name: "Terrain match",
    category: "mimicry",
    description: "Camouflage, loadout, or lighting that matches the local terrain so motion goes unnoticed.",
    execution: "Choose camo matching the biome; move during noise cover (engines, fights).",
    risk: "Still silhouetted on ridgelines and against the sky.",
    countersBait: true,
  },
  {
    id: "convoy-mimic",
    name: "Convoy mimic",
    category: "mimicry",
    description:
      "Adopt neutral or civilian-looking movement patterns — slow roads, no evasive flying — to read as AI traffic.",
    execution: "Fly/drive predictable routes at cruise speed; break pattern only at commitment.",
    risk: "Alert players spot a mimicking player; detection tools confirm it.",
    countersBait: true,
  },
  {
    id: "noise-throw",
    name: "Noise throw",
    category: "audio-bait",
    description: "Throwables, shots, or engine revs placed to send enemies toward the sound and away from you.",
    execution: "Trigger noise at the lure point, then move against the enemy's attention.",
    risk: "Close-range enemies localize sound quickly.",
    countersBait: false,
  },
  {
    id: "engine-bait",
    name: "Engine bait",
    category: "audio-bait",
    description:
      "Leave a vehicle idling or rev it then dismount — the engine signature draws patrols to an empty asset.",
    execution: "Idle the vehicle in a visible spot, set overwatch, wait for the investigators.",
    risk: "Experienced enemies check the driver seat first.",
    countersBait: false,
  },
  {
    id: "comms-bluff",
    name: "Comms bluff",
    category: "information",
    description: "Project strength or a plan you do not have — a confident call for backup that is not coming.",
    execution: "Announce a flank or asset 'inbound' on open comms where the game broadcasts it.",
    risk: "Only works where the enemy can overhear; useless on closed comms.",
    countersBait: false,
  },
  {
    id: "emergency-egress-fake",
    name: "Fake disengage",
    category: "information",
    description: "Signal a full retreat — then re-engage the pursuit when it overextends.",
    execution: "Break contact convincingly, loop back on the pursuit's flank.",
    risk: "If the enemy does not chase, you have simply retreated.",
    countersBait: false,
  },
];

const CATEGORY_FOR_CAUSE: Record<string, DeceptionCategory[]> = {
  bait: ["mimicry", "information", "feint"],
  exposure: ["draw-fire", "feint", "audio-bait"],
  timing: ["lure", "feint"],
  resource: ["lure", "audio-bait"],
  environment: ["lure", "mimicry"],
};

const lastUse = new Map<string, number>();
const TACTIC_COOLDOWN_MS = 60_000;

export function listDeceptionTactics(): DeceptionTactic[] {
  return DECEPTION_TACTICS.map((tactic) => ({ ...tactic }));
}

export function getDeceptionTactic(id: string): DeceptionTactic | undefined {
  return DECEPTION_TACTICS.find((tactic) => tactic.id === id);
}

export function suggestDeception(guildId: string): { tactics: DeceptionTactic[]; basis: string } {
  const postmortem = analyzeDeath(guildId);
  const cause = postmortem.detected ? postmortem.cause.toLowerCase() : "";
  const key = Object.keys(CATEGORY_FOR_CAUSE).find((k) => cause.includes(k));
  const categories = key ? CATEGORY_FOR_CAUSE[key] : ["draw-fire", "lure"];
  const tactics = DECEPTION_TACTICS.filter((tactic) => categories.includes(tactic.category)).slice(0, 4);
  const basis = postmortem.detected
    ? `Last death cause: ${postmortem.cause}. Counter-patterns recommended:`
    : "No recent postmortem — general deception set:";
  return { tactics, basis };
}

export interface DeceptionResult {
  executed: boolean;
  tactic: DeceptionTactic;
  message: string;
  reaction?: GameReaction;
}

export function deployDeception(input: {
  guildId: string;
  channelId: string;
  game?: string;
  tacticId: string;
  requestedBy: string;
}): DeceptionResult {
  const tactic = getDeceptionTactic(input.tacticId);
  if (!tactic) {
    return {
      executed: false,
      tactic: DECEPTION_TACTICS[0],
      message: `Unknown tactic. Options: ${DECEPTION_TACTICS.map((t) => t.id).join(", ")}`,
    };
  }
  const key = `${input.guildId}:${tactic.id}`;
  const now = Date.now();
  const since = now - (lastUse.get(key) ?? 0);
  if (since < TACTIC_COOLDOWN_MS) {
    return {
      executed: false,
      tactic,
      message: `${tactic.name} was used ${Math.ceil(since / 1000)}s ago — the enemy just saw it. Wait ~${Math.ceil((TACTIC_COOLDOWN_MS - since) / 1000)}s.`,
    };
  }
  lastUse.set(key, now);

  const state = getGameState(input.guildId);
  const telemetry = normalizeTelemetry({
    guildId: input.guildId,
    channelId: input.channelId,
    game: input.game ?? state?.game ?? "unknown",
    phase: "match",
    event: `deception ${tactic.id} ${tactic.category} deployed`,
    analysis: `${tactic.name} executed by ${input.requestedBy}.`,
  });
  const reaction = telemetry ? evaluateGameRules(updateGameState(telemetry)) : undefined;

  recordDiagnostic({
    guildId: input.guildId,
    channelId: input.channelId,
    game: telemetry?.game ?? "unknown",
    source: "telemetry",
    stage: "rules",
    outcome: "ok",
    event: telemetry?.event,
    ruleId: reaction?.ruleId,
    detail: `Deception tactic ${tactic.id} deployed by ${input.requestedBy}`,
  });

  return {
    executed: true,
    tactic,
    reaction,
    message: [
      `**${tactic.name}** (${tactic.category}) — ${tactic.description}`,
      `Execute: ${tactic.execution}`,
      `Watch for: ${tactic.risk}`,
    ].join("\n"),
  };
}

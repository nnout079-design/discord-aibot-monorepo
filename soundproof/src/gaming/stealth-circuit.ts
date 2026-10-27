export interface Vec2 {
  x: number;
  y: number;
}

export interface LightSource extends Vec2 {
  intensity: number;
  radius: number;
  kind?: string;
  shootable?: boolean;
}

export interface CoverSpot extends Vec2 {
  id: string;
  cover: number;
  terrain?: string;
}

export interface Threat extends Vec2 {
  id?: string;
}

export interface CamoProfile {
  pattern: string;
  coverage: number;
  terrains: string[];
}

export interface StealthScene {
  agent: Vec2 & { id?: string; terrain?: string };
  lights: LightSource[];
  spots: CoverSpot[];
  threats: Threat[];
  camo: CamoProfile;
  ambientLight?: number;
  secondsLit?: number;
}

export interface StealthTuning {
  lightWeight: number;
  camoMultiplier: number;
  lightsShootable?: boolean;
  shootOutAfterSeconds: number;
  shotRevealRadius: number;
  shootRange: number;
  sources: Array<{ title: string; date: string; rule: string; excerpt: string }>;
}

export const DEFAULT_TUNING: StealthTuning = {
  lightWeight: 1,
  camoMultiplier: 1,
  shootOutAfterSeconds: 6,
  shotRevealRadius: 8,
  shootRange: 25,
  sources: []
};

export const LIT_THRESHOLD = 0.5;
export const MOVING_CAMO_FACTOR = 0.6;
export const MAX_LIGHTS = 64;
export const MAX_SPOTS = 256;
export const MAX_THREATS = 64;

export interface StealthTarget {
  spotId: string;
  x: number;
  y: number;
  exposure: number;
  illumination: number;
  pathExposure: number;
  score: number;
}

export interface StealthPlan {
  stages: ["sense", "assess", "decide", "act"];
  currentIllumination: number;
  currentExposure: number;
  litLights: Array<{ index: number; kind: string; distance: number }>;
  target: StealthTarget | null;
  exposureReduction: number;
  camo: { mode: "full"; pattern: string; effectiveness: number };
  risk: "low" | "medium" | "high";
  shootOut: { index: number; kind: string; distance: number; exposureAfter: number } | null;
  actions: string[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lightContributionAt(p: Vec2, light: LightSource, tuning: StealthTuning): number {
  if (light.radius <= 0) return 0;
  const remaining = Math.max(0, 1 - distance(p, light) / light.radius);
  return light.intensity * remaining * remaining * tuning.lightWeight;
}

export function illuminationAt(p: Vec2, lights: LightSource[], ambient = 0.1, tuning: StealthTuning = DEFAULT_TUNING): number {
  const light = lights.reduce((total, source) => {
    return total + lightContributionAt(p, source, tuning);
  }, ambient);
  return clamp01(light);
}

export function camoEffectiveness(camo: CamoProfile, terrain: string | undefined, illumination: number, moving = false, tuning: StealthTuning = DEFAULT_TUNING): number {
  const terrainMatches = Boolean(terrain && camo.terrains.some(value => value.toLowerCase() === terrain.toLowerCase()));
  const base = camo.coverage * (terrainMatches ? 1 : 0.5) * tuning.camoMultiplier;
  const effective = base * (1 - 0.5 * clamp01(illumination)) * (moving ? MOVING_CAMO_FACTOR : 1);
  return Math.min(0.95, Math.max(0, effective));
}

export function exposureAt(p: Vec2, cover: number, terrain: string | undefined, scene: StealthScene, moving = false, tuning: StealthTuning = DEFAULT_TUNING): number {
  const illumination = illuminationAt(p, scene.lights, scene.ambientLight ?? 0.1, tuning);
  const camouflage = camoEffectiveness(scene.camo, terrain, illumination, moving, tuning);
  return illumination * (1 - camouflage) * (1 - clamp01(cover));
}

function threatPenalty(position: Vec2, threats: Threat[]): number {
  return threats.reduce((total, threat) => total + 0.2 * Math.max(0, 1 - distance(position, threat) / 20), 0);
}

function pathExposure(agent: Vec2, spot: CoverSpot, scene: StealthScene, tuning: StealthTuning): number {
  let exposure = 0;
  for (let step = 1; step <= 5; step += 1) {
    const fraction = step / 5;
    const point = {
      x: agent.x + (spot.x - agent.x) * fraction,
      y: agent.y + (spot.y - agent.y) * fraction
    };
    exposure += exposureAt(point, 0, scene.agent.terrain, scene, true, tuning);
  }
  return exposure / 5;
}

interface ScoredSpot {
  spot: CoverSpot;
  exposure: number;
  illumination: number;
  pathExposure: number;
  score: number;
}

export function runStealthCircuit(scene: StealthScene, tuning: StealthTuning = DEFAULT_TUNING): StealthPlan {
  const agent = scene.agent;
  const currentIllumination = illuminationAt(agent, scene.lights, scene.ambientLight ?? 0.1, tuning);
  const currentExposure = exposureAt(agent, 0, agent.terrain, scene, false, tuning);
  const litLights = scene.lights
    .map((light, index) => ({ index, kind: light.kind ?? "light", distance: distance(agent, light) }))
    .filter(light => light.distance <= scene.lights[light.index].radius)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(light => ({ ...light, distance: round3(light.distance) }));
  const scoredSpots: ScoredSpot[] = scene.spots.map(spot => {
    const illumination = illuminationAt(spot, scene.lights, scene.ambientLight ?? 0.1, tuning);
    const exposure = exposureAt(spot, spot.cover, spot.terrain, scene, false, tuning);
    const routeExposure = pathExposure(agent, spot, scene, tuning);
    return {
      spot,
      exposure,
      illumination,
      pathExposure: routeExposure,
      score: exposure + 0.15 * routeExposure + threatPenalty(spot, scene.threats)
    };
  });
  const darkSpots = scoredSpots.filter(candidate => candidate.illumination < LIT_THRESHOLD);
  const noDarkCover = darkSpots.length === 0;
  const candidates = noDarkCover ? scoredSpots : darkSpots;
  candidates.sort((a, b) => a.score - b.score || (a.spot.id < b.spot.id ? -1 : a.spot.id > b.spot.id ? 1 : 0));
  const best = candidates[0];
  const currentScore = currentExposure + threatPenalty(agent, scene.threats);
  const selected = best && best.score < currentScore ? best : undefined;
  const target: StealthTarget | null = selected
    ? {
      spotId: selected.spot.id,
      x: round3(selected.spot.x),
      y: round3(selected.spot.y),
      exposure: round3(selected.exposure),
      illumination: round3(selected.illumination),
      pathExposure: round3(selected.pathExposure),
      score: round3(selected.score)
    }
    : null;
  const finalExposure = target?.exposure ?? currentExposure;
  const targetTerrain = selected ? selected.spot.terrain : agent.terrain;
  const targetIllumination = target?.illumination ?? currentIllumination;
  const camo = {
    mode: "full" as const,
    pattern: scene.camo.pattern,
    effectiveness: round3(camoEffectiveness(scene.camo, targetTerrain, targetIllumination, false, tuning))
  };
  const risk = finalExposure < 0.15 ? "low" : finalExposure < 0.4 ? "medium" : "high";
  const actions = litLights.map(light => `Leave the light of ${light.kind} #${light.index} (${light.distance.toFixed(1)}m)`);
  const chosenSpot = selected?.spot;
  const eligibleLights = scene.lights
    .map((light, index) => {
      const kind = light.kind ?? "light";
      const lightDistance = distance(agent, light);
      const contribution = lightContributionAt(agent, light, tuning);
      const onChosenPath = chosenSpot ? Array.from({ length: 5 }, (_, indexOnPath) => {
        const fraction = (indexOnPath + 1) / 5;
        return lightContributionAt({
          x: agent.x + (chosenSpot.x - agent.x) * fraction,
          y: agent.y + (chosenSpot.y - agent.y) * fraction
        }, light, tuning) > 0;
      }).some(Boolean) : false;
      return { light, index, kind, distance: lightDistance, contribution, onChosenPath };
    })
    .filter(candidate =>
      (candidate.light.shootable ?? tuning.lightsShootable ?? false) &&
      !candidate.kind.toLowerCase().includes("muzzle") &&
      candidate.distance <= tuning.shootRange &&
      (candidate.contribution > 0 || candidate.onChosenPath)
    )
    .sort((a, b) => b.contribution - a.contribution || a.distance - b.distance || a.index - b.index);
  const nearbyThreats = scene.threats.filter(threat => distance(agent, threat) <= tuning.shotRevealRadius);
  let shootOut: StealthPlan["shootOut"] = null;
  let shootOutExposureAfter: number | undefined;
  let shootOutAction: string | undefined;
  if (currentIllumination >= LIT_THRESHOLD && eligibleLights.length > 0) {
    const candidate = eligibleLights[0];
    if (nearbyThreats.length > 0) {
      shootOutAction = `Too close to ${nearbyThreats.length} threat(s) to shoot out lights — stay mobile`;
    } else if (noDarkCover || (scene.secondsLit ?? 0) >= tuning.shootOutAfterSeconds) {
      const lights = scene.lights.filter((_, index) => index !== candidate.index);
      const sceneAfterShot = { ...scene, lights };
      shootOutExposureAfter = exposureAt(agent, 0, agent.terrain, sceneAfterShot, false, tuning);
      shootOut = {
        index: candidate.index,
        kind: candidate.kind,
        distance: round3(candidate.distance),
        exposureAfter: round3(shootOutExposureAfter)
      };
    } else {
      const remaining = Math.max(0, tuning.shootOutAfterSeconds - (scene.secondsLit ?? 0));
      shootOutAction = `Holding fire on lights — will shoot out ${candidate.kind} #${candidate.index} after ${remaining.toFixed(0)}s more in the light`;
    }
  }
  const holdAfterShot = Boolean(shootOut && shootOutExposureAfter !== undefined && shootOutExposureAfter < (selected?.exposure ?? currentExposure));
  if (shootOut) {
    actions.push(`Shoot out ${shootOut.kind} #${shootOut.index} (${shootOut.distance.toFixed(1)}m) — then relocate, the shot gives away your position`);
    if (holdAfterShot) actions.push("Hold position after shooting");
  } else if (shootOutAction) {
    actions.push(shootOutAction);
  }
  if (noDarkCover) actions.push("No dark cover available — pick the least-lit spot and minimise movement");
  if (target && !holdAfterShot) {
    actions.push(`Move to shadow spot ${target.spotId} (exposure ${currentExposure.toFixed(2)} → ${target.exposure.toFixed(2)})`);
  } else if (!holdAfterShot) {
    actions.push("Hold position in shadow");
  }
  actions.push(`Engage full camouflage (${camo.pattern}, ${Math.round(camo.effectiveness * 100)}% effective)`);
  actions.push("Freeze once in cover — movement cuts camouflage to 60%");
  if (scene.threats.length > 0) {
    actions.push("Keep out of threat sight-lines; do not return fire from lit areas");
  }

  return {
    stages: ["sense", "assess", "decide", "act"],
    currentIllumination: round3(currentIllumination),
    currentExposure: round3(currentExposure),
    litLights,
    target,
    exposureReduction: round3(currentExposure - finalExposure),
    camo,
    risk,
    shootOut,
    actions
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === "string";
}

export function parseStealthScene(input: unknown): StealthScene | undefined {
  if (!isRecord(input) || !isRecord(input.agent) || !isRecord(input.camo)) return undefined;
  if (!Array.isArray(input.lights) || !Array.isArray(input.spots) || !Array.isArray(input.threats)) return undefined;
  if (input.lights.length > MAX_LIGHTS || input.spots.length > MAX_SPOTS || input.threats.length > MAX_THREATS) return undefined;
  if (!finiteNumber(input.agent.x) || !finiteNumber(input.agent.y) ||
      !optionalString(input.agent, "id") || !optionalString(input.agent, "terrain")) return undefined;
  if (input.secondsLit !== undefined && (!finiteNumber(input.secondsLit) || input.secondsLit < 0)) return undefined;
  if (!finiteNumber(input.camo.coverage) || typeof input.camo.pattern !== "string" || input.camo.pattern.length > 64 ||
      !Array.isArray(input.camo.terrains) || input.camo.terrains.length > 16 ||
      !input.camo.terrains.every(terrain => typeof terrain === "string")) return undefined;
  if (input.ambientLight !== undefined && !finiteNumber(input.ambientLight)) return undefined;

  const lights: LightSource[] = [];
  for (const value of input.lights) {
    if (!isRecord(value) || !finiteNumber(value.x) || !finiteNumber(value.y) ||
        !finiteNumber(value.intensity) || !finiteNumber(value.radius) || value.radius <= 0 ||
        !optionalString(value, "kind") || (value.shootable !== undefined && typeof value.shootable !== "boolean")) return undefined;
    lights.push({
      x: value.x,
      y: value.y,
      intensity: clamp01(value.intensity),
      radius: value.radius,
      ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
      ...(typeof value.shootable === "boolean" ? { shootable: value.shootable } : {})
    });
  }

  const spots: CoverSpot[] = [];
  for (const value of input.spots) {
    if (!isRecord(value) || !finiteNumber(value.x) || !finiteNumber(value.y) ||
        typeof value.id !== "string" || value.id.trim().length === 0 || value.id.length > 64 ||
        !finiteNumber(value.cover) || !optionalString(value, "terrain")) return undefined;
    spots.push({
      x: value.x,
      y: value.y,
      id: value.id,
      cover: clamp01(value.cover),
      ...(typeof value.terrain === "string" ? { terrain: value.terrain } : {})
    });
  }

  const threats: Threat[] = [];
  for (const value of input.threats) {
    if (!isRecord(value) || !finiteNumber(value.x) || !finiteNumber(value.y) ||
        !optionalString(value, "id")) return undefined;
    threats.push({
      x: value.x,
      y: value.y,
      ...(typeof value.id === "string" ? { id: value.id } : {})
    });
  }

  return {
    agent: {
      x: input.agent.x,
      y: input.agent.y,
      ...(typeof input.agent.id === "string" ? { id: input.agent.id } : {}),
      ...(typeof input.agent.terrain === "string" ? { terrain: input.agent.terrain } : {})
    },
    lights,
    spots,
    threats,
    camo: {
      pattern: input.camo.pattern,
      coverage: clamp01(input.camo.coverage),
      terrains: [...input.camo.terrains] as string[]
    },
    ...(typeof input.ambientLight === "number" ? { ambientLight: clamp01(input.ambientLight) } : {}),
    ...(typeof input.secondsLit === "number" ? { secondsLit: input.secondsLit } : {})
  };
}

const litSince = new Map<string, number>();

export function updateLitTimer(key: string, lit: boolean, nowMs = Date.now()): number {
  if (!lit) {
    litSince.delete(key);
    return 0;
  }
  const since = litSince.get(key);
  if (since === undefined) {
    litSince.set(key, nowMs);
    return 0;
  }
  return Math.max(0, (nowMs - since) / 1000);
}

const lastPlans = new Map<string, { plan: StealthPlan; at: string }>();

function copyPlan(plan: StealthPlan): StealthPlan {
  return {
    ...plan,
    stages: [...plan.stages] as StealthPlan["stages"],
    litLights: plan.litLights.map(light => ({ ...light })),
    target: plan.target ? { ...plan.target } : null,
    shootOut: plan.shootOut ? { ...plan.shootOut } : null,
    camo: { ...plan.camo },
    actions: [...plan.actions]
  };
}

export function recordStealthPlan(guildId: string, plan: StealthPlan): void {
  lastPlans.set(guildId, { plan: copyPlan(plan), at: new Date().toISOString() });
}

export function getLastStealthPlan(guildId: string): { plan: StealthPlan; at: string } | undefined {
  const stored = lastPlans.get(guildId);
  return stored ? { plan: copyPlan(stored.plan), at: stored.at } : undefined;
}

export const DEMO_SCENE: StealthScene = {
  agent: { id: "agent", x: 0, y: 0, terrain: "urban" },
  lights: [
    { kind: "streetlamp", x: 0, y: 0, intensity: 1, radius: 8, shootable: true },
    { kind: "muzzle flash", x: 1, y: 0, intensity: 0.7, radius: 4 }
  ],
  spots: [
    { id: "lit doorway", x: 3, y: 0, cover: 1, terrain: "urban" },
    { id: "dark alley", x: 9, y: 0, cover: 0.8, terrain: "urban" },
    { id: "bushes", x: 7, y: 7, cover: 0.9, terrain: "forest" }
  ],
  threats: [
    { id: "threat-a", x: 7, y: 7 },
    { id: "threat-b", x: 6, y: 8 }
  ],
  secondsLit: 8,
  camo: { pattern: "urban digital", coverage: 0.8, terrains: ["urban"] }
};

export function formatStealthPlan(plan: StealthPlan): string {
  const finalExposure = plan.target?.exposure ?? plan.currentExposure;
  const target = plan.target
    ? `${plan.target.spotId} (${plan.target.x.toFixed(3)}, ${plan.target.y.toFixed(3)})`
    : "hold position";
  const actions = plan.actions.map((action, index) => `${index + 1}. ${action}`).join("\n");
  const formatted = [
    `**Stealth circuit — ${plan.risk.toUpperCase()} risk**`,
    `Exposure: ${plan.currentExposure.toFixed(3)} → ${finalExposure.toFixed(3)}`,
    `Target: ${target}`,
    `Camouflage: full — ${plan.camo.pattern} (${(plan.camo.effectiveness * 100).toFixed(1)}% effective)`,
    "Actions:",
    actions
  ].join("\n");
  return formatted.length <= 1800 ? formatted : `${formatted.slice(0, 1799)}…`;
}

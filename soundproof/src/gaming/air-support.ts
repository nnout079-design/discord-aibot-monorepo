import { normalizeTelemetry, updateGameState } from "./game-state";
import { evaluateGameRules, GameReaction } from "./rules";
import { recordDiagnostic } from "./diagnostics";
import { sendPushbulletNote } from "../notifications/pushbullet";

export type AirAssetType = "helicopter" | "plane";
export type AirAssetStatus = "ready" | "inbound" | "on-station" | "cooldown";
export type AirMission = "strike" | "escort" | "transport" | "recon" | "repair" | "resupply";

export interface AirAsset {
  callsign: string;
  type: AirAssetType;
  status: AirAssetStatus;
  abortCode: string;
  payload: string;
  mission?: AirMission;
  inboundUntil?: number;
  onStationUntil?: number;
  availableAt?: number;
  lastTarget?: string;
  requestedBy?: string;
}

const HELICOPTER_CALLSIGNS = ["Raider-1", "Raider-2"];
const PLANE_CALLSIGNS = ["Viper-1", "Viper-2"];
const TRANSIT_MS = 30_000;
const ABORT_LETTERS = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT"];
const INGRESS_POINTS = ["VIKING", "HAMMER", "FALCON", "COBRA", "EAGLE"];
const DIRECTIONS = ["north", "east", "south", "west"];

interface MissionProfile {
  allowedTypes: AirAssetType[];
  playtimeMs: number;
  cooldownMs: Record<AirAssetType, number>;
  payloads: Record<AirAssetType, string[]>;
  brief: (input: { target?: string; mark?: string; dangerClose?: boolean; asset: AirAsset }) => string[];
  eventLabel: string;
}

const MISSIONS: Record<AirMission, MissionProfile> = {
  strike: {
    allowedTypes: ["helicopter", "plane"],
    playtimeMs: 3 * 60_000,
    cooldownMs: { helicopter: 5 * 60_000, plane: 10 * 60_000 },
    payloads: {
      helicopter: ["rocket pods + door guns", "ATGM + cannon"],
      plane: ["2x GBU", "gun run + flare loadout"],
    },
    eventLabel: "strike/CAS",
    brief: ({ target, mark, dangerClose, asset: _asset }) => [
      `1. IP: ${randomFrom(INGRESS_POINTS)}`,
      `5. Target: ${target ?? "targets of opportunity"}`,
      `6. Location: as marked${target ? ` — ${target}` : ""}`,
      `7. Mark: ${mark ?? "no mark — talk-on required"}`,
      `8. Friendlies: ${dangerClose ? "**DANGER CLOSE** — friendlies in the engagement area" : "clear of target area"}`,
      `9. Egress: ${randomFrom(DIRECTIONS)}`,
    ],
  },
  escort: {
    allowedTypes: ["helicopter", "plane"],
    playtimeMs: 5 * 60_000,
    cooldownMs: { helicopter: 4 * 60_000, plane: 8 * 60_000 },
    payloads: {
      helicopter: ["escort guns + flares", "rocket pods"],
      plane: ["air-to-air loadout", "CAP package"],
    },
    eventLabel: "escort",
    brief: ({ target }) => [
      `Task: escort ${target ?? "friendly element"}`,
      "Profile: orbit the escorted element, weapons-free on confirmed threats",
      `Egress: ${randomFrom(DIRECTIONS)} when the element is clear`,
    ],
  },
  transport: {
    allowedTypes: ["helicopter"],
    playtimeMs: 4 * 60_000,
    cooldownMs: { helicopter: 5 * 60_000, plane: 0 },
    payloads: {
      helicopter: ["troop bay (8 pax)", "sling-load capable"],
      plane: [],
    },
    eventLabel: "troop movement",
    brief: ({ target, dangerClose }) => [
      `Task: troop movement — pickup/lift for ${target ?? "squad at current position"}`,
      dangerClose ? "**LZ is hot** — brief a fast approach and covering fire" : "LZ reported cold",
      "Confirm pickup grid and drop grid before wheels-up",
    ],
  },
  recon: {
    allowedTypes: ["helicopter", "plane"],
    playtimeMs: 6 * 60_000,
    cooldownMs: { helicopter: 3 * 60_000, plane: 6 * 60_000 },
    payloads: {
      helicopter: ["EO/IR sensor ball", "scout + marker rockets"],
      plane: ["high-altitude sensor pod", "fast recon pass"],
    },
    eventLabel: "recon/scouting",
    brief: ({ target }) => [
      `Task: recon sweep of ${target ?? "the objective area"}`,
      "Profile: sensor sweep, report contacts by grid, no engagement unless fired upon",
      "Contacts are reported back through game telemetry",
    ],
  },
  repair: {
    allowedTypes: ["helicopter"],
    playtimeMs: 4 * 60_000,
    cooldownMs: { helicopter: 6 * 60_000, plane: 0 },
    payloads: {
      helicopter: ["field repair kit + crew", "recovery sling"],
      plane: [],
    },
    eventLabel: "repair",
    brief: ({ target, dangerClose }) => [
      `Task: field repair of ${target ?? "damaged asset"}`,
      dangerClose ? "**Repair site is contested** — request covering escort" : "Site reported secure",
      "Profile: land adjacent, crew dismounts, asset returns to service",
    ],
  },
  resupply: {
    allowedTypes: ["helicopter", "plane"],
    playtimeMs: 2 * 60_000,
    cooldownMs: { helicopter: 4 * 60_000, plane: 7 * 60_000 },
    payloads: {
      helicopter: ["ammo + med crate sling", "fuel bladder"],
      plane: ["paradrop supply bundle"],
    },
    eventLabel: "resupply",
    brief: ({ target, mark }) => [
      `Task: resupply drop at ${target ?? "marked position"}`,
      `Mark: ${mark ?? "smoke recommended for the drop zone"}`,
      "Profile: one pass, drop, immediate egress",
    ],
  },
};

const fleets = new Map<string, AirAsset[]>();

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function newAsset(callsign: string, type: AirAssetType): AirAsset {
  return {
    callsign,
    type,
    status: "ready",
    abortCode: randomFrom(ABORT_LETTERS),
    payload: "unarmed",
  };
}

function fleetFor(guildId: string): AirAsset[] {
  let fleet = fleets.get(guildId);
  if (!fleet) {
    fleet = [
      ...HELICOPTER_CALLSIGNS.map((callsign) => newAsset(callsign, "helicopter")),
      ...PLANE_CALLSIGNS.map((callsign) => newAsset(callsign, "plane")),
    ];
    fleets.set(guildId, fleet);
  }
  const now = Date.now();
  for (const asset of fleet) {
    if (asset.status === "inbound" && asset.inboundUntil && asset.inboundUntil <= now) asset.status = "on-station";
    if (asset.status === "on-station" && asset.onStationUntil && asset.onStationUntil <= now) asset.status = "cooldown";
    if (asset.status === "cooldown" && asset.availableAt && asset.availableAt <= now) {
      asset.status = "ready";
      asset.mission = undefined;
      asset.inboundUntil = undefined;
      asset.onStationUntil = undefined;
      asset.availableAt = undefined;
    }
  }
  return fleet;
}

export interface AirSupportResult {
  dispatched: boolean;
  message: string;
  asset?: AirAsset;
  reaction?: GameReaction;
}

export async function requestAirSupport(input: {
  guildId: string;
  channelId: string;
  game?: string;
  mission?: AirMission;
  assetType: AirAssetType;
  target?: string;
  mark?: string;
  dangerClose?: boolean;
  requestedBy: string;
}): Promise<AirSupportResult> {
  const mission: AirMission = input.mission ?? "strike";
  const profile = MISSIONS[mission];
  if (!profile.allowedTypes.includes(input.assetType)) {
    return {
      dispatched: false,
      message: `A ${input.assetType} cannot fly ${mission} missions. Allowed: ${profile.allowedTypes.join(", ")}.`,
    };
  }

  const fleet = fleetFor(input.guildId);
  const asset = fleet.find((item) => item.type === input.assetType && item.status === "ready");
  if (!asset) {
    const next = fleet
      .filter((item) => item.type === input.assetType)
      .sort((a, b) => (a.availableAt ?? 0) - (b.availableAt ?? 0))[0];
    const wait = next?.availableAt ? Math.ceil((next.availableAt - Date.now()) / 1000) : undefined;
    return {
      dispatched: false,
      message: `No ${input.assetType} is ready.${wait ? ` Next available in ~${wait}s.` : ""}`,
    };
  }

  const now = Date.now();
  asset.status = "inbound";
  asset.mission = mission;
  asset.payload = randomFrom(profile.payloads[input.assetType]);
  asset.inboundUntil = now + TRANSIT_MS;
  asset.onStationUntil = asset.inboundUntil + profile.playtimeMs;
  asset.availableAt = asset.onStationUntil + profile.cooldownMs[input.assetType];
  asset.lastTarget = input.target;
  asset.requestedBy = input.requestedBy;

  const dangerClose = Boolean(input.dangerClose);
  const telemetry = normalizeTelemetry({
    guildId: input.guildId,
    channelId: input.channelId,
    game: input.game ?? "unknown",
    phase: "match",
    event: `air-support ${profile.eventLabel} ${asset.callsign} inbound${input.target ? ` to ${input.target}` : ""}${dangerClose ? " danger close" : ""}`,
    analysis: `Mission ${mission} called by ${input.requestedBy}. Abort code ${asset.abortCode}. On-station ${Math.round(profile.playtimeMs / 60000)} min.`,
  });
  const reaction = telemetry ? evaluateGameRules(updateGameState(telemetry)) : undefined;

  recordDiagnostic({
    guildId: input.guildId,
    channelId: input.channelId,
    game: input.game ?? "unknown",
    source: "telemetry",
    stage: "rules",
    outcome: "ok",
    event: telemetry?.event,
    ruleId: reaction?.ruleId,
    detail: `${asset.callsign} ${mission} tasked by ${input.requestedBy}${input.target ? ` to ${input.target}` : ""}${dangerClose ? " (danger close)" : ""}`,
  });

  await sendPushbulletNote(
    {
      title: `${input.game ?? "Game"}: ${profile.eventLabel} inbound${dangerClose ? " (DANGER CLOSE)" : ""}`,
      body: `${asset.callsign} (${input.assetType}) on ${mission} tasking by ${input.requestedBy}${input.target ? ` to ${input.target}` : ""}. Abort code ${asset.abortCode}.`,
    },
    `air-support:${input.guildId}:${asset.callsign}`,
    120_000
  );

  const brief = [
    `**${asset.callsign}** (${input.assetType}) checking in — mission: **${profile.eventLabel}**, payload: ${asset.payload}, playtime: ${Math.round(profile.playtimeMs / 60000)} min, abort code **${asset.abortCode}**.`,
    ``,
    `**Brief:**`,
    ...profile.brief({ target: input.target, mark: input.mark, dangerClose, asset }),
    ``,
    `ETA ~30s to on-station. Abort with \`/game air-abort callsign:${asset.callsign}\` (call ${asset.abortCode} three times).`,
  ];

  return { dispatched: true, asset, reaction, message: brief.join("\n") };
}

export async function abortAirSupport(input: {
  guildId: string;
  channelId: string;
  game?: string;
  callsign?: string;
  requestedBy: string;
}): Promise<{ aborted: AirAsset[]; message: string }> {
  const fleet = fleetFor(input.guildId);
  const now = Date.now();
  const targets = fleet.filter(
    (asset) =>
      (asset.status === "inbound" || asset.status === "on-station") &&
      (!input.callsign || asset.callsign.toLowerCase() === input.callsign.toLowerCase())
  );
  if (!targets.length) {
    return {
      aborted: [],
      message: input.callsign
        ? `${input.callsign} is not inbound or on-station.`
        : "No air assets are inbound or on-station.",
    };
  }
  for (const asset of targets) {
    asset.status = "cooldown";
    asset.inboundUntil = undefined;
    asset.onStationUntil = undefined;
    asset.availableAt = now + COOLDOWN_HALF[asset.type];
    recordDiagnostic({
      guildId: input.guildId,
      channelId: input.channelId,
      game: input.game ?? "unknown",
      source: "telemetry",
      stage: "rules",
      outcome: "ok",
      event: `air-support abort ${asset.callsign}`,
      detail: `${asset.callsign} aborted (${asset.abortCode} x3) by ${input.requestedBy}`,
    });
  }
  const calls = targets
    .map(
      (asset) =>
        `${asset.callsign}: **${asset.abortCode} ${asset.abortCode} ${asset.abortCode}** — abort acknowledged, RTB.`
    )
    .join("\n");
  return { aborted: targets, message: `Abort called by ${input.requestedBy}:\n${calls}` };
}

const COOLDOWN_HALF: Record<AirAssetType, number> = { helicopter: 2.5 * 60_000, plane: 5 * 60_000 };

export function getAirSupportStatus(guildId: string): AirAsset[] {
  return fleetFor(guildId).map((asset) => ({ ...asset }));
}

export function listMissions(): { id: AirMission; types: AirAssetType[] }[] {
  return Object.entries(MISSIONS).map(([id, profile]) => ({ id: id as AirMission, types: profile.allowedTypes }));
}

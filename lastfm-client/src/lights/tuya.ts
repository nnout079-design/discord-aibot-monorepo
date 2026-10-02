import crypto from "node:crypto";
import { EntryPlan } from "../sync/entry";
import { LightPlan } from "./palette";

const REGIONS: Record<string, string> = {
  eu: "https://openapi.tuyaeu.com",
  "eu-west": "https://openapi-weaz.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  "us-east": "https://openapi-ueaz.tuyaus.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com"
};

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

export interface SignInput {
  clientId: string;
  secret: string;
  t: string;
  nonce: string;
  method: string;
  /** Path plus query, query keys sorted. */
  url: string;
  body: string;
  accessToken?: string;
  /** "key:value\n" lines for headers named in Signature-Headers. */
  signedHeaders?: string;
}

// Tuya cloud request signature (HMAC-SHA256, upper-case hex).
export function tuyaSign(input: SignInput): string {
  const stringToSign = [input.method, sha256(input.body), input.signedHeaders ?? "", input.url].join("\n");
  return crypto.createHmac("sha256", input.secret)
    .update(input.clientId + (input.accessToken ?? "") + input.t + input.nonce + stringToSign)
    .digest("hex")
    .toUpperCase();
}

export interface TuyaFunction {
  code: string;
  type: string;
  values: string;
}

export interface TuyaCommand {
  code: string;
  value: unknown;
}

interface TuyaResponse<T> {
  success: boolean;
  result?: T;
  code?: number;
  msg?: string;
}

const TOKEN_INVALID = 1010;

export class TuyaClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private clientId: string, private secret: string, private baseUrl: string, private fetchImpl: typeof fetch = fetch) {}

  static fromEnv(env = process.env): TuyaClient | null {
    const { TUYA_ACCESS_ID: id, TUYA_ACCESS_SECRET: secret } = env;
    if (!id || !secret) return null;
    const region = (env.TUYA_REGION ?? "eu").toLowerCase();
    const baseUrl = REGIONS[region] ?? (region.startsWith("https://") ? region : null);
    if (!baseUrl) throw new Error(`TUYA_REGION must be one of ${Object.keys(REGIONS).join(", ")}`);
    return new TuyaClient(id, secret, baseUrl);
  }

  private async call<T>(method: "GET" | "POST", url: string, body?: object, auth = true): Promise<T> {
    const text = body === undefined ? "" : JSON.stringify(body);
    const t = String(Date.now());
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const accessToken = auth ? await this.accessToken() : undefined;
    const headers: Record<string, string> = { client_id: this.clientId, t, nonce, sign_method: "HMAC-SHA256", "content-type": "application/json" };
    if (accessToken) headers.access_token = accessToken;
    headers.sign = tuyaSign({ clientId: this.clientId, secret: this.secret, t, nonce, method, url, body: text, accessToken });
    const response = await this.fetchImpl(this.baseUrl + url, { method, headers, body: text || undefined, signal: AbortSignal.timeout(5000) });
    const json = await response.json() as TuyaResponse<T>;
    if (!json.success) {
      if (json.code === TOKEN_INVALID) this.token = null;
      throw new Error(`Tuya ${url.split("?")[0]}: ${json.msg ?? json.code ?? response.status}`);
    }
    return json.result as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const result = await this.call<{ access_token: string; expire_time: number }>("GET", "/v1.0/token?grant_type=1", undefined, false);
    this.token = { value: result.access_token, expiresAt: Date.now() + result.expire_time * 1000 };
    return result.access_token;
  }

  async functions(deviceId: string): Promise<TuyaFunction[]> {
    const result = await this.call<{ functions: TuyaFunction[] }>("GET", `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/functions`);
    return result.functions ?? [];
  }

  async send(deviceId: string, commands: TuyaCommand[]): Promise<void> {
    await this.call<boolean>("POST", `/v1.0/iot-03/devices/${encodeURIComponent(deviceId)}/commands`, { commands });
  }
}

interface Range {
  code: string;
  min: number;
  max: number;
}

// Which instruction codes a galaxy/star projector offers. Covers the standard light set (switch_led, work_mode,
// colour_data[_v2]) and the star-projector set (laser_switch, laser_bright, colour_switch, fan_switch/fan_speed for the motor).
export interface GalaxyCodes {
  power?: string;
  mode?: TuyaCommand;
  colour?: { code: string; s: number; v: number };
  nebula?: string;
  laser?: string;
  laserBright?: Range;
  motor?: string;
  motorSpeed?: Range;
}

function values(fn: TuyaFunction | undefined): Record<string, unknown> {
  try {
    return fn ? JSON.parse(fn.values) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function range(fn: TuyaFunction | undefined): Range | undefined {
  if (!fn) return undefined;
  const v = values(fn) as { min?: number; max?: number };
  return { code: fn.code, min: v.min ?? 0, max: v.max ?? 1000 };
}

export function galaxyCodes(functions: TuyaFunction[]): GalaxyCodes {
  const byCode = new Map(functions.map(fn => [fn.code, fn]));
  const has = (code: string) => byCode.has(code) ? code : undefined;
  const codes: GalaxyCodes = {
    power: has("switch_led"),
    nebula: has("colour_switch"),
    laser: has("laser_switch"),
    laserBright: range(byCode.get("laser_bright")),
    motor: has("fan_switch"),
    motorSpeed: range(byCode.get("fan_speed"))
  };
  for (const [code, value] of [["work_mode", "colour"], ["star_work_mode", "manual"]]) {
    const modes = values(byCode.get(code)).range;
    if (Array.isArray(modes) && modes.includes(value)) {
      codes.mode = { code, value };
      break;
    }
  }
  const colour = byCode.get("colour_data_v2") ?? byCode.get("colour_data");
  if (colour) {
    const v = values(colour) as { s?: { max?: number }; v?: { max?: number } };
    const fallback = colour.code === "colour_data_v2" ? 1000 : 255;
    codes.colour = { code: colour.code, s: v.s?.max ?? fallback, v: v.v?.max ?? fallback };
  }
  return codes;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round((h * 60 + 360) % 360), s: max ? d / max : 0, v: max };
}

export interface GalaxyState {
  on: boolean;
  colour?: string;
  /** 0-1 */
  level?: number;
  /** 0-1 star rotation speed */
  speed?: number;
}

const scale = (r: Range, x: number) => Math.round(r.min + (r.max - r.min) * Math.min(1, Math.max(0, x)));

export function galaxyCommands(codes: GalaxyCodes, state: GalaxyState): TuyaCommand[] {
  if (!state.on) {
    return codes.power ? [{ code: codes.power, value: false }] : [codes.laser, codes.nebula].filter((c): c is string => !!c).map(code => ({ code, value: false }));
  }
  const level = state.level ?? 1;
  const commands: TuyaCommand[] = [];
  if (codes.power) commands.push({ code: codes.power, value: true });
  if (codes.mode) commands.push(codes.mode);
  if (codes.nebula) commands.push({ code: codes.nebula, value: true });
  if (codes.colour && state.colour) {
    const hsv = hexToHsv(state.colour);
    commands.push({ code: codes.colour.code, value: { h: hsv.h, s: Math.round(hsv.s * codes.colour.s), v: Math.max(1, Math.round(hsv.v * level * codes.colour.v)) } });
  }
  if (codes.laser) commands.push({ code: codes.laser, value: true });
  if (codes.laserBright) commands.push({ code: codes.laserBright.code, value: scale(codes.laserBright, level) });
  if (codes.motor) commands.push({ code: codes.motor, value: (state.speed ?? 0) > 0 });
  if (codes.motorSpeed && state.speed !== undefined) commands.push({ code: codes.motorSpeed.code, value: scale(codes.motorSpeed, state.speed) });
  return commands;
}

export interface ProjectorCue {
  at: number;
  rig: number;
  state: GalaxyState;
}

export const CUE_BARS = 4;
const MAX_SONG_MS = 6 * 60_000;

// One cloud command per rig per CUE_BARS bars (cloud round trips are too slow for every beat): dim on the count-in,
// full on the downbeat, then the two rigs step through the palette a colour apart, and switch off at the end.
export function projectorCues(plan: EntryPlan, lights: LightPlan, durationMs?: number): ProjectorCue[] {
  const colour = (step: number, rig: number) => lights.palette[(step + rig) % lights.palette.length];
  const endAt = plan.startAt + Math.min(durationMs ?? MAX_SONG_MS, MAX_SONG_MS);
  const cues: ProjectorCue[] = [];
  for (const rig of [0, 1]) cues.push({ at: plan.countInAt, rig, state: { on: true, colour: colour(0, rig), level: 0.3, speed: 0.15 } });
  for (let step = 0, at = plan.startAt; at < endAt; step++, at += plan.barMs * CUE_BARS) {
    for (const rig of [0, 1]) cues.push({ at, rig, state: { on: true, colour: colour(step, rig), level: 1, speed: lights.energy } });
  }
  for (const rig of [0, 1]) cues.push({ at: endAt, rig, state: { on: false } });
  return cues;
}

// Two (or more) Tuya / Smart Life galaxy projectors driven from the bot through the Tuya cloud.
// Device n plays rig n % 2, so with two projectors they mirror each other a palette colour apart.
export class GalaxyProjectors {
  private timers: NodeJS.Timeout[] = [];
  private codes = new Map<string, Promise<GalaxyCodes>>();

  constructor(private client: TuyaClient, private devices: string[], private leadMs = 300, private log: (message: string) => void = console.log) {}

  static fromEnv(env = process.env): GalaxyProjectors | null {
    const client = TuyaClient.fromEnv(env);
    const devices = (env.TUYA_DEVICE_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
    if (!client || devices.length === 0) return null;
    return new GalaxyProjectors(client, devices, Number(env.TUYA_LEAD_MS ?? 300));
  }

  private codesFor(device: string): Promise<GalaxyCodes> {
    let codes = this.codes.get(device);
    if (!codes) {
      codes = this.client.functions(device).then(galaxyCodes);
      codes.catch(() => this.codes.delete(device));
      this.codes.set(device, codes);
    }
    return codes;
  }

  private async apply(rig: number, state: GalaxyState): Promise<void> {
    await Promise.all(this.devices.map(async (device, i) => {
      if (i % 2 !== rig) return;
      try {
        await this.client.send(device, galaxyCommands(await this.codesFor(device), state));
      } catch (error) {
        this.log(`Galaxy projector ${device}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }

  private clear(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  play(plan: EntryPlan, lights: LightPlan, durationMs?: number): void {
    this.clear();
    this.devices.forEach(device => void this.codesFor(device).catch(() => {}));
    for (const cue of projectorCues(plan, lights, durationMs)) {
      this.timers.push(setTimeout(() => void this.apply(cue.rig, cue.state), Math.max(0, cue.at - this.leadMs - Date.now())));
    }
  }

  stop(): void {
    this.clear();
    void Promise.all([this.apply(0, { on: false }), this.apply(1, { on: false })]);
  }
}

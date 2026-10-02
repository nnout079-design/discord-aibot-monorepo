import fs from "node:fs";
import { FixtureConfig, PROFILES } from "./fixtures";

export const OUTPUTS = ["open-dmx", "enttec-pro", "artnet", "log", "none"] as const;
export type OutputKind = typeof OUTPUTS[number];

export interface LightsConfig {
  /** open-dmx (FTDI USB-DMX cables, Enttec Open DMX), enttec-pro (Enttec DMX USB Pro, DMXking), artnet (network node), log, none */
  output: OutputKind;
  /** USB-DMX COM port, or "auto" for the first FTDI/Enttec/DMX port */
  port?: string;
  /** Art-Net node IP, or 255.255.255.255 to broadcast */
  host?: string;
  /** Art-Net universe (0-32767) */
  universe?: number;
  /** DMX frames per second */
  fps?: number;
  /** Lights get each frame this many ms early to make up for slow fixtures. */
  latencyMs?: number;
  fixtures: FixtureConfig[];
}

export const DEFAULT_LIGHTS: LightsConfig = {
  output: "open-dmx",
  port: "auto",
  host: "255.255.255.255",
  universe: 0,
  fps: 40,
  latencyMs: 0,
  fixtures: [
    { name: "Galaxy A", profile: "showtec-galaxy-360-18ch", address: 1, rig: 0, tiltRange: [0.3, 0.7] },
    { name: "Galaxy B", profile: "showtec-galaxy-360-18ch", address: 19, rig: 1, tiltRange: [0.3, 0.7] }
  ]
};

export function validateLights(config: LightsConfig): string[] {
  const errors: string[] = [];
  if (!(OUTPUTS as readonly string[]).includes(config.output)) errors.push(`output must be one of ${OUTPUTS.join(", ")}`);
  const used = new Map<number, string>();
  for (const fixture of config.fixtures) {
    const profile = PROFILES[fixture.profile];
    if (!profile) {
      errors.push(`${fixture.name}: unknown profile "${fixture.profile}" (use ${Object.keys(PROFILES).join(", ")})`);
      continue;
    }
    const last = fixture.address + profile.channels - 1;
    if (!Number.isInteger(fixture.address) || fixture.address < 1 || last > 512) {
      errors.push(`${fixture.name}: address ${fixture.address} + ${profile.channels} channels does not fit in 1-512`);
      continue;
    }
    for (let ch = fixture.address; ch <= last; ch++) {
      const other = used.get(ch);
      if (other) {
        errors.push(`${fixture.name} overlaps ${other} at channel ${ch}`);
        break;
      }
      used.set(ch, fixture.name);
    }
  }
  return errors;
}

/** Reads lights.json; null when it doesn't exist (lights off). */
export function loadLights(file: string): LightsConfig | null {
  if (!fs.existsSync(file)) return null;
  const config = { ...DEFAULT_LIGHTS, ...JSON.parse(fs.readFileSync(file, "utf8")) } as LightsConfig;
  const errors = validateLights(config);
  if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
  return config;
}

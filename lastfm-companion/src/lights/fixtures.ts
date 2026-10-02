import { RigState } from "./show";

export const PROFILES = {
  "showtec-galaxy-360-18ch": { channels: 18, label: "Showtec Galaxy 360 (18-channel mode)" },
  "showtec-galaxy-360-10ch": { channels: 10, label: "Showtec Galaxy 360 (10-channel mode)" },
  "beamz-galaxy5-60ch": { channels: 60, label: "beamZ Galaxy5 moving-head bar (60-channel mode)" },
  "beamz-galaxy5-11ch": { channels: 11, label: "beamZ Galaxy5 moving-head bar (11-channel mode)" },
  "rgbw-dimmer": { channels: 5, label: "Generic dimmer + RGBW" },
  rgb: { channels: 3, label: "Generic RGB" }
} as const;

export type ProfileName = keyof typeof PROFILES;

export interface FixtureConfig {
  name: string;
  profile: ProfileName;
  /** DMX start address, 1-512 */
  address: number;
  /** Which galaxy rig it follows: 0 = A, 1 = B */
  rig: number;
  invertPan?: boolean;
  invertTilt?: boolean;
  /** Part of the pan/tilt travel used, 0-1 (e.g. [0.3, 0.7] keeps the beams on stage). */
  panRange?: [number, number];
  tiltRange?: [number, number];
}

const byte = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
const word = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 65535);

// Showtec Galaxy 360, 10-channel mode, CH7 colour presets (manual, order code 45054): [DMX value, R, G, B, W].
const GALAXY360_PRESETS: [number, number, number, number, number][] = [
  [10, 255, 0, 0, 0], [17, 255, 0, 0, 100], [24, 255, 0, 0, 200], [31, 255, 50, 0, 0], [38, 255, 150, 0, 0],
  [45, 255, 255, 0, 0], [52, 255, 255, 0, 75], [59, 0, 255, 0, 255], [66, 0, 255, 0, 150], [73, 0, 255, 0, 50],
  [80, 0, 255, 0, 0], [87, 0, 255, 50, 0], [94, 0, 255, 150, 0], [101, 0, 255, 255, 0], [108, 0, 255, 255, 75],
  [115, 0, 255, 255, 150], [122, 0, 100, 255, 255], [129, 0, 0, 255, 100], [136, 0, 0, 255, 50], [143, 0, 0, 255, 0],
  [150, 75, 0, 255, 0], [157, 160, 0, 255, 0], [164, 255, 0, 255, 0], [171, 255, 0, 175, 0], [178, 255, 0, 100, 0],
  [185, 255, 0, 100, 50], [192, 255, 0, 25, 50], [199, 255, 0, 25, 25], [206, 255, 0, 25, 0], [213, 0, 0, 0, 255],
  [220, 75, 75, 0, 255], [227, 0, 0, 100, 255], [243, 255, 255, 255, 255]
];

// beamZ Galaxy5 LED-ring colour (CH10 in 11-channel mode, CH11 per head in 60-channel mode): [DMX value, R, G, B].
const GALAXY5_RING: [number, number, number, number][] = [
  [26, 1, 0, 0], [59, 0, 1, 0], [92, 0, 0, 1], [125, 1, 1, 0], [158, 1, 0, 1], [191, 0, 1, 1], [231, 1, 1, 1]
];

// beamZ Galaxy5 11-channel mode, CH7 beam colours 1-15: [R, G, B, W] on/off.
const GALAXY5_BEAM: [number, number, number, number][] = [
  [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 1, 0, 0], [1, 0, 1, 0], [1, 0, 0, 1], [0, 1, 1, 0],
  [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 1, 0], [1, 1, 0, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]
];

function nearest<T extends number[]>(table: T[], target: number[], from = 0): T {
  let best = table[0];
  let bestDistance = Infinity;
  for (const row of table) {
    const distance = target.reduce((sum, value, i) => sum + (row[i + from] - value) ** 2, 0);
    if (distance < bestDistance) [best, bestDistance] = [row, distance];
  }
  return best;
}

function ringColour(s: RigState): number {
  if (Math.max(s.r, s.g, s.b) < 0.05 && s.w < 0.05) return 0;
  const top = Math.max(s.r, s.g, s.b, s.w);
  return nearest(GALAXY5_RING, [s.r, s.g, s.b].map(c => Math.min(1, c / top + s.w)), 1)[0];
}

function axis(value: number, range: [number, number] = [0, 1], invert = false): number {
  const v = invert ? 1 - value : value;
  return range[0] + (range[1] - range[0]) * v;
}

// The fixture's channel values (index 0 = its start address) for a rig state. Channel maps are from the makers' manuals.
export function fixtureChannels(fixture: FixtureConfig, s: RigState): number[] {
  const pan = axis(s.pan, fixture.panRange, fixture.invertPan);
  const tilt = axis(s.tilt, fixture.tiltRange, fixture.invertTilt);
  const [r, g, b, w] = [s.r, s.g, s.b, s.w].map(byte);
  switch (fixture.profile) {
    case "showtec-galaxy-360-18ch": {
      const [p, t] = [word(pan), word(tilt)];
      // 1 pan, 2 pan fine, 3 tilt, 4 tilt fine, 5 P/T speed (0 = fastest), 6-7 continuous pan/tilt off, 8 dimmer,
      // 9-10 strobe off, 11-14 presets/running/speed/functions off, 15-18 R G B W.
      return [p >> 8, p & 255, t >> 8, t & 255, 0, 0, 0, byte(s.dimmer), 0, 0, 0, 0, 0, 0, r, g, b, w];
    }
    case "showtec-galaxy-360-10ch": {
      // 1 pan, 2 tilt, 3-4 continuous off, 5 dimmer, 6 strobe off, 7 colour preset, 8-10 off.
      const preset = nearest(GALAXY360_PRESETS, [r, g, b, w], 1)[0];
      return [byte(pan), byte(tilt), 0, 0, byte(s.dimmer), 0, preset, 0, 0, 0];
    }
    case "beamz-galaxy5-11ch": {
      // 1 dimmer, 2 strobe off, 3 pan, 4 tilt, 5 show off, 6 sensitivity, 7 beam colour, 8 beam speed, 9 ring effect off,
      // 10 ring colour, 11 X/Y angle.
      const on = [s.r, s.g, s.b, s.w].map(c => c >= 0.5 ? 1 : 0);
      const top = Math.max(s.r, s.g, s.b, s.w);
      if (!on.some(Boolean) && top > 0) on[[s.r, s.g, s.b, s.w].indexOf(top)] = 1;
      const beam = on.some(Boolean) ? GALAXY5_BEAM.findIndex(row => row.every((v, i) => v === on[i])) + 1 : 0;
      return [byte(s.dimmer), 0, byte(pan), byte(tilt), 0, 0, beam, 0, 0, ringColour(s), 0];
    }
    case "beamz-galaxy5-60ch": {
      // Five heads x 12: pan, tilt, X/Y speed (0 = fastest), dimmer, strobe off, R, G, B, W, ring effect off, ring colour, reset off.
      // The heads fan out around the rig's pan position.
      const ring = ringColour(s);
      return [0, 1, 2, 3, 4].flatMap(head => {
        const fan = axis(Math.min(1, Math.max(0, s.pan + (head - 2) * 0.06)), fixture.panRange, fixture.invertPan);
        return [byte(fan), byte(tilt), 0, byte(s.dimmer), 0, r, g, b, w, 0, ring, 0];
      });
    }
    case "rgbw-dimmer":
      return [byte(s.dimmer), r, g, b, w];
    case "rgb":
      return [s.r, s.g, s.b].map(c => byte(Math.min(1, c + s.w) * s.dimmer));
  }
}

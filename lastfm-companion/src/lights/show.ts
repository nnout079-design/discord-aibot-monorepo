/** Colours and energy chosen by the bot from the song's Last.fm data (song-entry `lights`). */
export interface LightPlan {
  palette: string[];
  energy: number;
}

export const GALAXY_PALETTE = ["#7a00ff", "#1a3cff", "#00c8ff", "#ff2fd0"];

export type Rgb = [number, number, number];

/** What one galaxy rig should do right now; every value is 0-1. */
export interface RigState {
  r: number;
  g: number;
  b: number;
  w: number;
  dimmer: number;
  pan: number;
  tilt: number;
}

/** Everything a rig needs to follow one song entry, in this PC's clock. */
export interface LightShow {
  palette: Rgb[];
  energy: number;
  beatMs: number;
  beatsPerBar: number;
  countInAt: number;
  startAt: number;
  endAt: number | null;
  /** Local times where arrangement sections come in; the rigs flash on them. */
  accents: number[];
}

export const BLACKOUT: RigState = { r: 0, g: 0, b: 0, w: 0, dimmer: 0, pan: 0.5, tilt: 0.5 };

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [1, 1, 1];
}

export function buildShow(
  event: { beatMs: number; beatsPerBar: number; lights?: LightPlan },
  local: { countInAt: number; startAt: number; endAt: number | null },
  accents: number[] = []
): LightShow {
  const plan = event.lights?.palette.length ? event.lights : { palette: GALAXY_PALETTE, energy: event.lights?.energy ?? 0.6 };
  return {
    palette: plan.palette.map(hexToRgb),
    energy: Math.min(1, Math.max(0, plan.energy)),
    beatMs: event.beatMs,
    beatsPerBar: event.beatsPerBar,
    countInAt: local.countInAt,
    startAt: local.startAt,
    endAt: local.endAt,
    accents
  };
}

const ACCENT_BEATS = 1;
const STROBE_MS = 50;

// Rig 0 and rig 1 mirror each other: opposite pan sweeps, colours one palette step apart, the same beat pulse.
export function rigFrame(show: LightShow, rig: number, now: number): RigState {
  const { palette, energy, beatMs, beatsPerBar } = show;
  const colour = (step: number) => palette[(step + rig) % palette.length];
  if (show.endAt !== null && now >= show.endAt) return BLACKOUT;
  if (now < show.countInAt) {
    const [r, g, b] = colour(0);
    return { r, g, b, w: 0, dimmer: 0.12, pan: 0.5, tilt: 0.5 };
  }
  if (now < show.startAt) {
    const phase = ((now - show.countInAt) % beatMs) / beatMs;
    return { r: 0, g: 0, b: 0, w: 1, dimmer: 0.15 + 0.85 * Math.exp(-phase * 6), pan: 0.5, tilt: 0.5 };
  }
  const beats = (now - show.startAt) / beatMs;
  const beat = Math.floor(beats);
  const phase = beats - beat;
  const bar = Math.floor(beat / beatsPerBar);
  const bars = beats / beatsPerBar;
  const [r, g, b] = colour(Math.floor(bar / (energy >= 0.7 ? 1 : 2)));
  const base = 0.3 + 0.3 * (1 - energy);
  const kick = (beat % beatsPerBar === 0 ? 1 : 0.6) * Math.exp(-phase * 5);
  const side = rig % 2 === 0 ? 1 : -1;
  const state: RigState = {
    r, g, b, w: 0,
    dimmer: base + (1 - base) * kick,
    pan: 0.5 + side * (0.15 + 0.15 * energy) * Math.sin((Math.PI * bars) / 2),
    tilt: 0.5 + 0.15 * Math.sin((Math.PI * bars) / 4 + rig * Math.PI / 2)
  };
  if (show.accents.some(at => now >= at && now < at + ACCENT_BEATS * beatMs)) {
    state.w = 1;
    state.dimmer = Math.floor(now / STROBE_MS) % 2 === 0 ? 1 : 0;
  }
  return state;
}

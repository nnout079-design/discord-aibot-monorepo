import { MidiOut } from "./player";
import { COMPACT_PROGRAMS, Rig } from "./rig";

export interface Target {
  out: MidiOut;
  /** 0-15 */
  channel: number;
  program: number | null;
  latencyMs: number;
  range?: [number, number];
  drums: boolean;
}

export interface Router {
  main: MidiOut;
  dj: MidiOut | null;
  outs: MidiOut[];
  section(name: string): Target | undefined;
  /** One line per port saying where it went, for the startup log. */
  report: string[];
}

export function singleRouter(out: MidiOut): Router {
  return { main: out, dj: null, outs: [out], section: () => undefined, report: [] };
}

// Each rig port is opened if a matching MIDI output exists; sections on missing ports fall back
// to `fallback` on their compact channel, so a single General MIDI synth still plays everything.
export function buildRouter(rig: Rig, open: (name: string) => MidiOut | null, fallback: MidiOut, fallbackName: string): Router {
  const opened = new Map<string, MidiOut | null>();
  const report: string[] = [];
  for (const [key, name] of Object.entries(rig.ports)) {
    const out = open(name);
    opened.set(key, out);
    report.push(out ? `port ${key}: ${name}` : `port ${key}: "${name}" not found, ${key === rig.djPort ? "DJ booth off" : `using ${fallbackName}`}`);
  }
  const outs = [fallback, ...new Set([...opened.values()].filter((out): out is MidiOut => out !== null))];
  const targets = new Map<string, Target>();
  for (const [name, section] of Object.entries(rig.sections)) {
    const out = opened.get(section.port);
    const compact = !out;
    targets.set(name, {
      out: out ?? fallback,
      channel: (compact ? section.compactChannel : section.channel) - 1,
      program: section.drums ? null : compact ? COMPACT_PROGRAMS[section.compactChannel] ?? null : section.program ?? null,
      latencyMs: section.latencyMs ?? 0,
      range: section.range,
      drums: section.drums === true
    });
  }
  return {
    main: opened.get(rig.mainPort) ?? fallback,
    dj: rig.djPort ? opened.get(rig.djPort) ?? null : null,
    outs,
    section: name => targets.get(name),
    report
  };
}

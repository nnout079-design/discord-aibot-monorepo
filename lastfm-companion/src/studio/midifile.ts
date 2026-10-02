import { Midi } from "@tonejs/midi";
import { Rig } from "../rig";
import { Score } from "../score";

const DRUM_CHANNEL = 9;

// Gives each distinct GM program in `sections` its own channel (drums on 10), so any GM synth plays it right.
export function channelPlan(rig: Rig, sections: string[]): Map<string, { channel: number; program: number }> {
  const programs = new Map<number, number>();
  const free = [...Array(16).keys()].filter(c => c !== DRUM_CHANNEL);
  const plan = new Map<string, { channel: number; program: number }>();
  for (const name of sections) {
    const section = rig.sections[name];
    if (!section) continue;
    if (section.drums) {
      plan.set(name, { channel: DRUM_CHANNEL, program: 0 });
      continue;
    }
    const program = section.program ?? 0;
    if (!programs.has(program)) programs.set(program, free[programs.size % free.length]);
    plan.set(name, { channel: programs.get(program)!, program });
  }
  return plan;
}

// One MIDI track per rig section, named after it, at the score's tempo.
export function scoreToMidi(score: Score, rig: Rig, bpm: number, sections = score.sections): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.name = score.title;
  const plan = channelPlan(rig, sections);
  const tracks = new Map<string, ReturnType<Midi["addTrack"]>>();
  for (const name of sections) {
    const slot = plan.get(name);
    if (!slot) continue;
    const track = midi.addTrack();
    track.name = rig.sections[name].label;
    track.channel = slot.channel;
    track.instrument.number = slot.program;
    tracks.set(name, track);
  }
  for (const note of score.notes) {
    tracks.get(note.section)?.addNote({
      midi: note.note,
      velocity: note.velocity / 127,
      time: note.timeMs / 1000,
      duration: Math.max(0.01, note.durationMs / 1000)
    });
  }
  return midi.toArray();
}

export function sectionsByGroup(rig: Rig, score: Score): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const name of score.sections) {
    const group = rig.sections[name]?.group;
    if (!group) continue;
    groups.set(group, [...(groups.get(group) ?? []), name]);
  }
  return groups;
}

// When each section first plays, for on-screen "enters" captions.
export function entrances(rig: Rig, score: Score): { timeMs: number; labels: string[] }[] {
  const first = new Map<string, number>();
  for (const note of score.notes) {
    if (!first.has(note.section) || note.timeMs < first.get(note.section)!) first.set(note.section, note.timeMs);
  }
  const byTime = new Map<number, string[]>();
  for (const [name, timeMs] of first) {
    const key = Math.round(timeMs / 1000) * 1000;
    byTime.set(key, [...(byTime.get(key) ?? []), rig.sections[name]?.label ?? name]);
  }
  return [...byTime].sort((a, b) => a[0] - b[0]).map(([timeMs, labels]) => ({ timeMs, labels }));
}

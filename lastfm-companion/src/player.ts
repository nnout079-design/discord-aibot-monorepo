import { Router, singleRouter } from "./router";
import { moveIntoRange, Score } from "./score";

export interface MidiOut {
  send(bytes: number[]): void;
  close(): void;
}

export interface EntryHit {
  instrument: string;
  note: number;
  velocity: number;
  durationMs: number;
  offsetMs: number;
}

export interface TrackInfo {
  name: string;
  artist: string;
  album?: string;
  url?: string;
  durationMs?: number;
  tags: string[];
  mbid?: string;
  imageUrl?: string;
  summary?: string;
  artistTags?: string[];
  similarArtists?: string[];
  bpm?: number;
  timeSig?: number;
  key?: string;
  danceability?: number;
  acousticness?: number;
  genres?: string[];
  year?: number;
}

export interface SongEntryEvent {
  type: "song-entry";
  sentAt: number;
  countInAt: number;
  startAt: number;
  bpm: number;
  beatMs: number;
  barMs: number;
  beatsPerBar: number;
  pattern: string | null;
  track: TrackInfo | null;
  midi?: { channel: number; hits: EntryHit[] };
}

export interface LocalTimes {
  countInAt: number;
  startAt: number;
  endAt: number | null;
}

interface Scheduled {
  at: number;
  out: MidiOut;
  bytes: number[];
  end?: boolean;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL = 0xb0;
const PROGRAM = 0xc0;
const CLOCK = 0xf8;
const START = 0xfa;
const STOP = 0xfc;
export const LATE_MS = 40;
export const PROGRAM_LEAD_MS = 200;
export const DJ_PLAY_NOTE = 1;
export const DJ_STOP_NOTE = 2;
const DJ_PRESS_MS = 50;
const TAIL_MS = 1000;

// Converts a song-entry event (server times) and an optional full-song score into local MIDI messages
// and sends them when due. Late note-ons are dropped rather than bunched up; note-offs, Start and Stop are always sent.
export class Player {
  private queue: Scheduled[] = [];
  private next = 0;
  private clockAt: number | null = null;
  private clockMs = 0;
  private channel = 9;
  private djLoaded = false;
  private router: Router;

  constructor(out: MidiOut | Router, private options: { clock: boolean; now?: () => number; panicAll?: boolean }) {
    this.router = "send" in out ? singleRouter(out) : out;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get active(): boolean {
    return this.next < this.queue.length || this.clockAt !== null;
  }

  private push(at: number, out: MidiOut, bytes: number[]): void {
    this.queue.push({ at, out, bytes });
  }

  load(event: SongEntryEvent, offsetMs: number, score: Score | null = null): LocalTimes {
    if (this.active) this.stop();
    this.queue = [];
    this.next = 0;
    const main = this.router.main;
    this.channel = (event.midi?.channel ?? 9) & 0x0f;
    const countInAt = event.countInAt - offsetMs;
    const startAt = event.startAt - offsetMs;
    const trackEnd = event.track?.durationMs ? startAt + event.track.durationMs : null;
    const endAt = score ? startAt + score.durationMs + TAIL_MS : trackEnd;
    for (const hit of event.midi?.hits ?? []) {
      const at = countInAt + hit.offsetMs;
      this.push(at, main, [NOTE_ON | this.channel, hit.note, hit.velocity]);
      this.push(at + hit.durationMs, main, [NOTE_OFF | this.channel, hit.note, 0]);
    }
    if (score) this.loadScore(score, countInAt, startAt);
    const dj = this.router.dj;
    this.djLoaded = dj !== null;
    if (dj) {
      this.push(startAt, dj, [NOTE_ON, DJ_PLAY_NOTE, 127]);
      this.push(startAt + DJ_PRESS_MS, dj, [NOTE_OFF, DJ_PLAY_NOTE, 0]);
    }
    if (this.options.clock) {
      this.push(startAt, main, [START]);
      this.clockAt = countInAt;
      this.clockMs = 60000 / event.bpm / 24;
    }
    if (endAt !== null) this.queue.push({ at: endAt, out: main, bytes: [], end: true });
    this.queue.sort((a, b) => a.at - b.at);
    return { countInAt, startAt, endAt };
  }

  private loadScore(score: Score, countInAt: number, startAt: number): void {
    const programs = new Map<MidiOut, Map<number, number>>();
    for (const name of score.sections) {
      const target = this.router.section(name);
      if (!target || target.program === null) continue;
      const channels = programs.get(target.out) ?? new Map<number, number>();
      if (!channels.has(target.channel)) channels.set(target.channel, target.program);
      programs.set(target.out, channels);
    }
    for (const [out, channels] of programs) {
      for (const [channel, program] of channels) this.push(countInAt - PROGRAM_LEAD_MS, out, [PROGRAM | channel, program]);
    }
    for (const note of score.notes) {
      const target = this.router.section(note.section);
      if (!target) continue;
      const at = startAt + note.timeMs - target.latencyMs;
      const pitch = target.drums ? note.note : moveIntoRange(note.note, target.range);
      this.push(at, target.out, [NOTE_ON | target.channel, pitch, Math.max(1, Math.min(127, Math.round(note.velocity)))]);
      this.push(at + Math.max(10, note.durationMs), target.out, [NOTE_OFF | target.channel, pitch, 0]);
    }
  }

  stop(): void {
    const clockRunning = this.clockAt !== null;
    this.queue = [];
    this.next = 0;
    this.clockAt = null;
    if (clockRunning) this.router.main.send([STOP]);
    if (this.djLoaded && this.router.dj) {
      this.router.dj.send([NOTE_ON, DJ_STOP_NOTE, 127]);
      this.router.dj.send([NOTE_OFF, DJ_STOP_NOTE, 0]);
    }
    this.djLoaded = false;
    if (this.options.panicAll) this.panic();
    else this.router.main.send([CONTROL | this.channel, 123, 0]);
  }

  // All notes off and all sound off on every channel of every output.
  panic(): void {
    for (const out of this.router.outs) {
      for (let channel = 0; channel < 16; channel++) {
        out.send([CONTROL | channel, 123, 0]);
        out.send([CONTROL | channel, 120, 0]);
      }
    }
  }

  tick(): void {
    const now = this.now();
    while (this.next < this.queue.length && this.queue[this.next].at <= now) {
      const item = this.queue[this.next++];
      if (item.end) {
        this.stop();
        return;
      }
      const isNoteOn = (item.bytes[0] & 0xf0) === NOTE_ON && item.bytes[2] > 0;
      if (!isNoteOn || now - item.at <= LATE_MS) item.out.send(item.bytes);
    }
    if (this.clockAt !== null && this.clockAt <= now) {
      this.router.main.send([CLOCK]);
      this.clockAt += this.clockMs;
      if (now - this.clockAt > LATE_MS) this.clockAt = now + this.clockMs;
    }
  }
}

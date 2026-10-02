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
  track: { name: string; artist: string; album?: string; url?: string; durationMs?: number; tags: string[] } | null;
  midi?: { channel: number; hits: EntryHit[] };
}

export interface LocalTimes {
  countInAt: number;
  startAt: number;
  endAt: number | null;
}

interface Scheduled {
  at: number;
  bytes: number[];
  end?: boolean;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL = 0xb0;
const CLOCK = 0xf8;
const START = 0xfa;
const STOP = 0xfc;
export const LATE_MS = 40;

// Converts a song-entry event (server times) into local MIDI messages and sends them when due.
// Late note-ons are dropped rather than bunched up; note-offs, Start and Stop are always sent.
export class Player {
  private queue: Scheduled[] = [];
  private clockAt: number | null = null;
  private clockMs = 0;
  private channel = 9;

  constructor(private out: MidiOut, private options: { clock: boolean; now?: () => number }) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get active(): boolean {
    return this.queue.length > 0 || this.clockAt !== null;
  }

  load(event: SongEntryEvent, offsetMs: number): LocalTimes {
    if (this.active) this.stop();
    this.channel = (event.midi?.channel ?? 9) & 0x0f;
    const countInAt = event.countInAt - offsetMs;
    const startAt = event.startAt - offsetMs;
    const endAt = event.track?.durationMs ? startAt + event.track.durationMs : null;
    for (const hit of event.midi?.hits ?? []) {
      const at = countInAt + hit.offsetMs;
      this.queue.push({ at, bytes: [NOTE_ON | this.channel, hit.note, hit.velocity] });
      this.queue.push({ at: at + hit.durationMs, bytes: [NOTE_OFF | this.channel, hit.note, 0] });
    }
    if (this.options.clock) {
      this.queue.push({ at: startAt, bytes: [START] });
      this.clockAt = countInAt;
      this.clockMs = 60000 / event.bpm / 24;
    }
    if (endAt !== null) this.queue.push({ at: endAt, bytes: [], end: true });
    this.queue.sort((a, b) => a.at - b.at);
    return { countInAt, startAt, endAt };
  }

  stop(): void {
    const clockRunning = this.clockAt !== null;
    this.queue = [];
    this.clockAt = null;
    if (clockRunning) this.out.send([STOP]);
    this.out.send([CONTROL | this.channel, 123, 0]);
  }

  tick(): void {
    const now = this.now();
    while (this.queue.length > 0 && this.queue[0].at <= now) {
      const item = this.queue.shift()!;
      if (item.end) {
        this.stop();
        return;
      }
      const isNoteOn = (item.bytes[0] & 0xf0) === NOTE_ON;
      if (!isNoteOn || now - item.at <= LATE_MS) this.out.send(item.bytes);
    }
    if (this.clockAt !== null && this.clockAt <= now) {
      this.out.send([CLOCK]);
      this.clockAt += this.clockMs;
      if (now - this.clockAt > LATE_MS) this.clockAt = now + this.clockMs;
    }
  }
}

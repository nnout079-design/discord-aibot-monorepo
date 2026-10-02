export interface MIDINote {
  note: number;
  velocity: number;
  channel: number;
  duration: number;
  startTime: number;
}

export interface MIDIPattern {
  name: string;
  tempo: number;
  notes: MIDINote[];
  loop: boolean;
}

export interface MIDIEvent {
  type: 'noteOn' | 'noteOff' | 'clock' | 'start' | 'stop' | 'continue';
  data: number[];
  timestamp: number;
}

export class MIDISequencer {
  private isPlaying: boolean;
  private tempo: number;
  private currentBeat: number;
  private clockInterval: NodeJS.Timeout | null = null;
  private pattern: MIDIPattern | null = null;
  private currentNoteIndex: number = 0;
  private startTime: number = 0;
  private callbacks: {
    onClock?: () => void;
    onNote?: (note: MIDINote) => void;
    onStart?: () => void;
    onStop?: () => void;
    onPatternComplete?: () => void;
  } = {};

  constructor(tempo: number = 120) {
    this.isPlaying = false;
    this.tempo = tempo;
    this.currentBeat = 0;
  }

  setCallbacks(callbacks: {
    onClock?: () => void;
    onNote?: (note: MIDINote) => void;
    onStart?: () => void;
    onStop?: () => void;
    onPatternComplete?: () => void;
  }) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.currentBeat = 0;
    this.startTime = Date.now();
    this.currentNoteIndex = 0;

    if (this.callbacks.onStart) {
      this.callbacks.onStart();
    }

    // Start MIDI clock (24 PPQ - pulses per quarter note)
    const clockInterval = (60000 / this.tempo) / 24;
    this.clockInterval = setInterval(() => {
      this.sendClock();
    }, clockInterval);

    // Schedule notes
    this.scheduleNotes();
  }

  stop(): void {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this.currentBeat = 0;

    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }

    if (this.callbacks.onStop) {
      this.callbacks.onStop();
    }
  }

  continueSequencer(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;

    if (this.callbacks.onStart) {
      this.callbacks.onStart();
    }

    const clockInterval = (60000 / this.tempo) / 24;
    this.clockInterval = setInterval(() => {
      this.sendClock();
    }, clockInterval);

    this.scheduleNotes();
  }

  private sendClock(): void {
    this.currentBeat++;

    if (this.callbacks.onClock) {
      this.callbacks.onClock();
    }
  }

  loadPattern(pattern: MIDIPattern): void {
    this.pattern = pattern;
    this.tempo = pattern.tempo;
    this.currentNoteIndex = 0;

    if (this.isPlaying) {
      this.stop();
      this.start();
    }
  }

  private scheduleNotes(): void {
    if (!this.pattern || this.pattern.notes.length === 0) return;

    const now = Date.now();
    const patternStart = this.startTime;

    this.pattern.notes.forEach((note, index) => {
      const noteTime = patternStart + note.startTime;
      const delay = Math.max(0, noteTime - now);

      setTimeout(() => {
        if (this.isPlaying && this.pattern) {
          this.playNote(note);
          this.currentNoteIndex = index;

          if (index === this.pattern!.notes.length - 1) {
            if (this.pattern!.loop) {
              this.currentNoteIndex = 0;
              this.startTime = Date.now();
              this.scheduleNotes();
            } else if (this.callbacks.onPatternComplete) {
              this.callbacks.onPatternComplete();
            }
          }
        }
      }, delay);
    });
  }

  private playNote(note: MIDINote): void {
    if (this.callbacks.onNote) {
      this.callbacks.onNote(note);
    }

    // Schedule note off
    setTimeout(() => {
      if (this.callbacks.onNote) {
        this.callbacks.onNote({
          ...note,
          velocity: 0, // Note off
        });
      }
    }, note.duration);
  }

  triggerNote(note: number, velocity: number = 127, channel: number = 0, duration: number = 500): void {
    const midiNote: MIDINote = {
      note,
      velocity,
      channel,
      duration,
      startTime: 0,
    };

    this.playNote(midiNote);
  }

  setTempo(tempo: number): void {
    this.tempo = tempo;

    if (this.isPlaying) {
      this.stop();
      this.start();
    }
  }

  getTempo(): number {
    return this.tempo;
  }

  isRunning(): boolean {
    return this.isPlaying;
  }

  getCurrentBeat(): number {
    return this.currentBeat;
  }

  getPattern(): MIDIPattern | null {
    return this.pattern;
  }

  clearPattern(): void {
    this.pattern = null;
    this.currentNoteIndex = 0;
  }
}

// Pre-defined patterns for different song sections
export const PATTERNS: Record<string, MIDIPattern> = {
  intro: {
    name: 'Intro',
    tempo: 120,
    loop: false,
    notes: [
      { note: 60, velocity: 100, channel: 0, duration: 200, startTime: 0 },
      { note: 64, velocity: 100, channel: 0, duration: 200, startTime: 250 },
      { note: 67, velocity: 100, channel: 0, duration: 400, startTime: 500 },
    ],
  },
  build: {
    name: 'Build',
    tempo: 120,
    loop: true,
    notes: [
      { note: 36, velocity: 90, channel: 0, duration: 100, startTime: 0 },
      { note: 36, velocity: 90, channel: 0, duration: 100, startTime: 250 },
      { note: 38, velocity: 90, channel: 0, duration: 100, startTime: 500 },
      { note: 36, velocity: 90, channel: 0, duration: 100, startTime: 750 },
    ],
  },
  drop: {
    name: 'Drop',
    tempo: 128,
    loop: true,
    notes: [
      { note: 36, velocity: 127, channel: 0, duration: 100, startTime: 0 },
      { note: 36, velocity: 127, channel: 0, duration: 100, startTime: 125 },
      { note: 36, velocity: 127, channel: 0, duration: 100, startTime: 250 },
      { note: 36, velocity: 127, channel: 0, duration: 100, startTime: 375 },
      { note: 42, velocity: 100, channel: 0, duration: 200, startTime: 500 },
      { note: 36, velocity: 127, channel: 0, duration: 100, startTime: 750 },
    ],
  },
};

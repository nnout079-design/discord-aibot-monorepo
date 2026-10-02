import { CountdownTimer, SongInfo } from './countdown';
import { MIDISequencer, MIDIPattern, PATTERNS } from '../midi/sequencer';

export interface SyncConfig {
  countdownDuration: number;
  patternName: string;
  autoStart: boolean;
}

export class SyncManager {
  private countdown: CountdownTimer;
  private sequencer: MIDISequencer;
  private config: SyncConfig;
  private isInitialized: boolean = false;

  constructor(config: SyncConfig = {
    countdownDuration: 10,
    patternName: 'intro',
    autoStart: true,
  }) {
    this.config = config;
    this.countdown = new CountdownTimer(config.countdownDuration);
    this.sequencer = new MIDISequencer(120);
    this.setupCallbacks();
  }

  private setupCallbacks(): void {
    this.countdown.setCallbacks({
      onComplete: () => {
        console.log('Countdown complete - triggering MIDI sequence');
        this.triggerMIDI();
      },
      onSongChange: (song: SongInfo) => {
        console.log(`Syncing to song: ${song.name} by ${song.artist}`);
      },
    });

    this.sequencer.setCallbacks({
      onNote: (note) => {
        console.log(`MIDI Note: ${note.note} velocity:${note.velocity}`);
        // Here you would send actual MIDI messages to hardware/software
        // For now, we just log
      },
      onClock: () => {
        // MIDI clock tick
      },
      onStart: () => {
        console.log('MIDI Sequencer started');
      },
      onStop: () => {
        console.log('MIDI Sequencer stopped');
      },
      onPatternComplete: () => {
        console.log('MIDI Pattern complete');
      },
    });
  }

  initialize(): void {
    if (this.isInitialized) return;

    // Load the configured pattern
    const pattern = PATTERNS[this.config.patternName] || PATTERNS.intro;
    this.sequencer.loadPattern(pattern);

    this.isInitialized = true;
    console.log('Sync Manager initialized');
  }

  startSync(songStartTime: number, currentSong: SongInfo): void {
    if (!this.isInitialized) {
      this.initialize();
    }

    console.log('Starting sync for song:', currentSong.name);
    this.countdown.start(songStartTime, currentSong);
  }

  stopSync(): void {
    this.countdown.stop();
    this.sequencer.stop();
    console.log('Sync stopped');
  }

  private triggerMIDI(): void {
    console.log('Triggering MIDI pattern:', this.config.patternName);
    this.sequencer.start();
  }

  setPattern(patternName: string): void {
    const pattern = PATTERNS[patternName];
    if (pattern) {
      this.config.patternName = patternName;
      this.sequencer.loadPattern(pattern);
      console.log(`Pattern changed to: ${patternName}`);
    } else {
      console.error(`Pattern not found: ${patternName}`);
    }
  }

  setCountdownDuration(duration: number): void {
    this.config.countdownDuration = duration;
    this.countdown.setDuration(duration);
  }

  setTempo(tempo: number): void {
    this.sequencer.setTempo(tempo);
  }

  triggerManualNote(note: number, velocity: number = 127, channel: number = 0): void {
    this.sequencer.triggerNote(note, velocity, channel);
  }

  getStatus(): {
    countdown: boolean;
    sequencer: boolean;
    pattern: string;
    tempo: number;
  } {
    return {
      countdown: this.countdown.isRunning(),
      sequencer: this.sequencer.isRunning(),
      pattern: this.config.patternName,
      tempo: this.sequencer.getTempo(),
    };
  }

  getConfig(): SyncConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.countdownDuration !== undefined) {
      this.countdown.setDuration(config.countdownDuration);
    }

    if (config.patternName !== undefined) {
      this.setPattern(config.patternName);
    }
  }

  getAvailablePatterns(): string[] {
    return Object.keys(PATTERNS);
  }
}

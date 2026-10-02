export interface CountdownState {
  isActive: boolean;
  currentTime: number;
  targetTime: number;
  duration: number;
  startTime: number;
}

export interface SongInfo {
  name: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  imageUrl?: string;
}

export class CountdownTimer {
  private state: CountdownState;
  private intervalId: NodeJS.Timeout | null = null;
  private callbacks: {
    onTick?: (time: number) => void;
    onComplete?: () => void;
    onSongChange?: (song: SongInfo) => void;
  } = {};

  constructor(duration: number = 10) {
    this.state = {
      isActive: false,
      currentTime: duration,
      targetTime: 0,
      duration,
      startTime: 0,
    };
  }

  setCallbacks(callbacks: {
    onTick?: (time: number) => void;
    onComplete?: () => void;
    onSongChange?: (song: SongInfo) => void;
  }) {
    this.callbacks = callbacks;
  }

  start(songStartTime: number, currentSong: SongInfo): void {
    if (this.state.isActive) {
      this.stop();
    }

    const now = Date.now();
    const songStart = songStartTime;
    const timeUntilSong = Math.max(0, songStart - now);
    
    // Calculate countdown target (10 seconds before song start, or 3 seconds minimum)
    const countdownTarget = Math.max(3000, timeUntilSong - 10000);
    
    this.state = {
      isActive: true,
      currentTime: Math.ceil(countdownTarget / 1000),
      targetTime: songStart,
      duration: Math.ceil(countdownTarget / 1000),
      startTime: now,
    };

    // Notify about song change
    if (this.callbacks.onSongChange) {
      this.callbacks.onSongChange(currentSong);
    }

    // Start the countdown
    this.intervalId = setInterval(() => {
      const elapsed = Date.now() - this.state.startTime;
      const remaining = Math.max(0, countdownTarget - elapsed);
      this.state.currentTime = Math.ceil(remaining / 1000);

      if (this.callbacks.onTick) {
        this.callbacks.onTick(this.state.currentTime);
      }

      if (remaining <= 0) {
        this.complete();
      }
    }, 100); // Update every 100ms for smooth countdown
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.state.isActive = false;
    this.state.currentTime = this.state.duration;
  }

  private complete(): void {
    this.stop();
    if (this.callbacks.onComplete) {
      this.callbacks.onComplete();
    }
  }

  getState(): CountdownState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.state.isActive;
  }

  getCurrentTime(): number {
    return this.state.currentTime;
  }

  setDuration(duration: number): void {
    this.state.duration = duration;
    if (!this.state.isActive) {
      this.state.currentTime = duration;
    }
  }
}

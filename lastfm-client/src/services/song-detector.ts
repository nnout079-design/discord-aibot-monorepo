import { LastFmApi } from '../lastfm/api';
import { SongInfo } from './countdown';

export interface DetectionResult {
  hasSong: boolean;
  song?: SongInfo;
  timestamp: number;
}

export class SongDetector {
  private lastfm: LastFmApi;
  private username: string;
  private lastSong: SongInfo | null = null;
  private lastCheckTime: number = 0;
  private pollInterval: number = 5000; // 5 seconds
  private intervalId: NodeJS.Timeout | null = null;
  private callbacks: {
    onNewSong?: (song: SongInfo, startTime: number) => void;
    onSongEnded?: () => void;
    onError?: (error: Error) => void;
  } = {};

  constructor(lastfm: LastFmApi, username: string) {
    this.lastfm = lastfm;
    this.username = username;
  }

  setCallbacks(callbacks: {
    onNewSong?: (song: SongInfo, startTime: number) => void;
    onSongEnded?: () => void;
    onError?: (error: Error) => void;
  }) {
    this.callbacks = callbacks;
  }

  async detectSong(): Promise<DetectionResult> {
    try {
      const tracks = await this.lastfm.getRecentTracks(this.username, 1);
      
      if (!tracks || tracks.length === 0) {
        return {
          hasSong: false,
          timestamp: Date.now(),
        };
      }

      const track = tracks[0];

      // Check if the track is currently playing (@attr nowplaying="true")
      const isNowPlaying = track['@attr']?.nowplaying === 'true';

      if (!isNowPlaying) {
        if (this.lastSong && this.callbacks.onSongEnded) {
          this.callbacks.onSongEnded();
        }
        this.lastSong = null;
        return {
          hasSong: false,
          timestamp: Date.now(),
        };
      }

      const songInfo: SongInfo = {
        name: track.name,
        artist: track.artist?.['#text'] || 'Unknown',
        album: track.album?.['#text'] || 'Unknown',
        duration: 0, // Last.fm recent tracks doesn't provide duration
        position: 0, // Last.fm doesn't provide position for nowplaying
        imageUrl: track.image?.find((img: any) => img.size === 'large')?.['#text'],
      };

      // Check if this is a new song
      const isNewSong = !this.lastSong ||
        this.lastSong.name !== songInfo.name ||
        this.lastSong.artist !== songInfo.artist;

      if (isNewSong) {
        this.lastSong = songInfo;
        if (this.callbacks.onNewSong) {
          // Estimate song start time based on timestamp
          const startTime = Date.now();
          this.callbacks.onNewSong(songInfo, startTime);
        }
      }

      this.lastCheckTime = Date.now();
      return {
        hasSong: true,
        song: songInfo,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Song detection error:', error);
      if (this.callbacks.onError) {
        this.callbacks.onError(error as Error);
      }
      return {
        hasSong: false,
        timestamp: Date.now(),
      };
    }
  }

  startPolling(interval?: number): void {
    if (this.intervalId) {
      this.stopPolling();
    }

    if (interval) {
      this.pollInterval = interval;
    }

    this.intervalId = setInterval(async () => {
      await this.detectSong();
    }, this.pollInterval);
  }

  stopPolling(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setPollInterval(interval: number): void {
    this.pollInterval = interval;
    if (this.intervalId) {
      this.stopPolling();
      this.startPolling();
    }
  }

  setUsername(username: string): void {
    this.username = username;
  }

  getLastSong(): SongInfo | null {
    return this.lastSong;
  }

  isPolling(): boolean {
    return this.intervalId !== null;
  }
}

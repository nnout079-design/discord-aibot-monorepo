export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

// offsetMs = server time - local time, from the sample with the shortest round trip.
export function bestSample(samples: ClockSample[]): ClockSample {
  if (samples.length === 0) throw new Error("no clock samples");
  return samples.reduce((best, sample) => (sample.rttMs < best.rttMs ? sample : best));
}

export async function measure(botUrl: string, now: () => number = Date.now): Promise<ClockSample> {
  const sent = now();
  const response = await fetch(`${botUrl}/sync/time`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`/sync/time returned ${response.status}`);
  const { now: serverNow } = await response.json() as { now: number };
  const received = now();
  return { offsetMs: serverNow - (sent + received) / 2, rttMs: received - sent };
}

export class ClockSync {
  offsetMs = 0;
  rttMs = Infinity;

  constructor(private botUrl: string, private samples = 8) {}

  async sync(): Promise<ClockSample> {
    const samples: ClockSample[] = [];
    for (let i = 0; i < this.samples; i++) {
      try {
        samples.push(await measure(this.botUrl));
      } catch (error) {
        if (i === this.samples - 1 && samples.length === 0) throw error;
      }
    }
    const best = bestSample(samples);
    this.offsetMs = best.offsetMs;
    this.rttMs = best.rttMs;
    return best;
  }
}

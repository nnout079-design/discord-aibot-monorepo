import { LightsConfig } from "./config";
import { fixtureChannels } from "./fixtures";
import { DmxOutput, UNIVERSE_SIZE } from "./output";
import { BLACKOUT, LightShow, rigFrame } from "./show";

// One DMX universe for every fixture at `now`; blackout when no show is loaded.
export function renderUniverse(config: LightsConfig, show: LightShow | null, now: number): Uint8Array {
  const universe = new Uint8Array(UNIVERSE_SIZE);
  for (const fixture of config.fixtures) {
    const state = show ? rigFrame(show, fixture.rig, now) : BLACKOUT;
    universe.set(fixtureChannels(fixture, state), fixture.address - 1);
  }
  return universe;
}

// Sends a fresh universe every frame (DMX fixtures expect a continuous stream).
export class LightEngine {
  private show: LightShow | null = null;
  private timer: NodeJS.Timeout;

  constructor(private config: LightsConfig, private out: DmxOutput, private now: () => number = Date.now) {
    this.timer = setInterval(() => this.frame(), 1000 / (config.fps ?? 40));
  }

  load(show: LightShow): void {
    this.show = show;
  }

  stop(): void {
    this.show = null;
    this.frame();
  }

  close(): void {
    this.stop();
    clearInterval(this.timer);
    this.out.close();
  }

  private frame(): void {
    this.out.send(renderUniverse(this.config, this.show, this.now() + (this.config.latencyMs ?? 0)));
  }
}

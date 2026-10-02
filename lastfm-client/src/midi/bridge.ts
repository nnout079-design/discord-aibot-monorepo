import { PercussionHit } from "./world-percussion";
import { Batch } from "./schedule";

export interface MidiTrigger {
  type: "note-on" | "note-off";
  channel: number;
  note: number;
  velocity: number;
  durationMs: number;
  instrument: string;
  requestedAt: string;
}

export async function triggerMidi(hit: PercussionHit, channel = 9): Promise<MidiTrigger> {
  const trigger: MidiTrigger = {
    type: "note-on",
    channel: Math.max(0, Math.min(15, channel)),
    note: hit.note,
    velocity: hit.velocity,
    durationMs: hit.durationMs,
    instrument: hit.instrument,
    requestedAt: new Date().toISOString()
  };
  const bridgeUrl = process.env.MIDI_BRIDGE_URL;
  if (bridgeUrl) {
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(trigger),
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) throw new Error(`MIDI bridge returned ${response.status}`);
  } else {
    console.log("MIDI trigger", JSON.stringify(trigger));
  }
  return trigger;
}

export interface BatchTiming {
  startAt?: number;
  signal?: AbortSignal;
}

export async function triggerBatch(batch: Batch, channel = 9, timing: BatchTiming = {}): Promise<void> {
  const ch = Math.max(0, Math.min(15, channel));
  const url = process.env.MIDI_BRIDGE_URL;

  const { startAt, signal } = timing;
  const leadMs = startAt === undefined ? 100 : Math.max(0, Math.round(startAt - Date.now()));

  if (!url) {
    console.log("MIDI batch", JSON.stringify({ ...batch, channel: ch, startAt, leadMs }));
    return;
  }

  if (process.env.MIDI_BRIDGE_BATCH === "1") {
    const res = await fetch(`${url.replace(/\/$/, "")}/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bpm: batch.bpm, stepMs: batch.stepMs, channel: ch, leadMs, startAt, hits: batch.hits }),
      signal: AbortSignal.timeout(2000)
    });
    if (!res.ok) throw new Error(`MIDI bridge /batch returned ${res.status}`);
    signal?.addEventListener("abort", () => {
      fetch(`${url.replace(/\/$/, "")}/stop`, { method: "POST", signal: AbortSignal.timeout(2000) })
        .catch(error => console.error("MIDI bridge /stop failed:", error));
    }, { once: true });
    return;
  }

  console.warn("MIDI_BRIDGE_BATCH not set: setTimeout fallback, sub-ms swing is lost");
  const baseMs = startAt === undefined ? 0 : startAt - Date.now();
  await Promise.all(batch.hits.map(hit => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => triggerMidi(hit, ch).then(() => resolve(), reject), Math.max(0, baseMs + hit.offsetMs));
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  })));
}
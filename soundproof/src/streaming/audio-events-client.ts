export interface AudioDetection {
  label: string;
  score: number;
  is_vehicle: boolean;
}

export interface VehicleDetectionResult {
  model: string;
  durationSeconds: number;
  detections: AudioDetection[];
  isVehicle: boolean;
  topLabel: string | null;
  threshold: number;
}

interface VehicleApiResponse {
  model: string;
  duration_seconds: number;
  detections: AudioDetection[];
  is_vehicle: boolean;
  top_label: string | null;
  threshold: number;
}

export function audioEventsEnabled(): boolean {
  return Boolean(process.env.AUDIO_EVENTS_URL);
}

export async function detectVehicleNoise(audio: Buffer): Promise<VehicleDetectionResult | null> {
  const baseUrl = process.env.AUDIO_EVENTS_URL;
  if (!baseUrl) return null;

  const threshold = process.env.VEHICLE_NOISE_THRESHOLD;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/vehicle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audio_base64: audio.toString("base64"),
      ...(threshold ? { threshold: Number(threshold) } : {})
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`audio-events service returned ${response.status}`);
  }

  const raw = (await response.json()) as VehicleApiResponse;
  return {
    model: raw.model,
    durationSeconds: raw.duration_seconds,
    detections: raw.detections,
    isVehicle: raw.is_vehicle,
    topLabel: raw.top_label,
    threshold: raw.threshold
  };
}

import { run } from "./tools";

export interface MasterTarget {
  lufs: number;
  truePeakDb: number;
  lra: number;
}

export const STREAMING: MasterTarget = { lufs: -14, truePeakDb: -1, lra: 11 };

interface Loudness {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

// Clean-up and glue before loudness: rumble filter, gentle 2:1 bus compression from -18 dB.
const PRE = "highpass=f=25,acompressor=threshold=0.125:ratio=2:attack=20:release=250";

export function parseLoudness(output: string): Loudness {
  const json = output.slice(output.lastIndexOf("{"), output.lastIndexOf("}") + 1);
  return JSON.parse(json) as Loudness;
}

// Two-pass EBU R128 master: measure, then normalise linearly to the target with a true-peak ceiling.
export function remaster(mixPath: string, wavOut: string, mp3Out: string, target = STREAMING): Loudness {
  const loud = `loudnorm=I=${target.lufs}:TP=${target.truePeakDb}:LRA=${target.lra}`;
  const m = parseLoudness(run("ffmpeg", ["-hide_banner", "-nostats", "-i", mixPath, "-af", `${PRE},${loud}:print_format=json`, "-f", "null", "-"], { capture: true }));
  const second = `${PRE},${loud}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", mixPath, "-af", second, "-ar", "48000", "-c:a", "pcm_s24le", wavOut]);
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", wavOut, "-c:a", "libmp3lame", "-b:a", "320k", mp3Out]);
  return m;
}

export function measure(path: string): Loudness {
  return parseLoudness(run("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { capture: true }));
}

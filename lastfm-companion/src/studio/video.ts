import fs from "node:fs";
import path from "node:path";
import { GALAXY_PALETTE, hexToRgb } from "../lights/show";
import { run } from "./tools";

export interface VideoPlan {
  title: string;
  subtitle: string;
  bpm: number;
  beatsPerBar: number;
  durationMs: number;
  entrances: { timeMs: number; labels: string[] }[];
  /** Galaxy rig colours (#rrggbb) and 0-1 energy from the bot's light plan. */
  palette?: string[];
  energy?: number;
}

const BEAM_FILE = "beam.png";

// Two galaxy light rigs on the stage floor, as in the companion's live show: beams a palette colour apart that
// change colour every bar (every two bars for calmer songs), flare on each beat and sweep in mirror image.
// Input 2 is a white beam sprite; each colour/brightness gets its own tinted copy, switched on by `enable`.
export function galaxyBeams(plan: VideoPlan, input: string, output: string): string[] {
  const palette = (plan.palette?.length ? plan.palette : GALAXY_PALETTE).map(hexToRgb);
  const energy = plan.energy ?? 0.6;
  const beat = 60 / plan.bpm;
  const bar = beat * plan.beatsPerBar;
  const step = bar * (energy >= 0.7 ? 1 : 2);
  const sweep = (0.06 + 0.06 * energy).toFixed(3);
  const layers = [0, 1].flatMap(rig => palette.flatMap((_, i) => [true, false].map(bright => ({ rig, i, bright }))));
  const filters = [`[2:v]format=rgba,split=${layers.length}${layers.map((_, j) => `[s${j}]`).join("")}`];
  let last = input;
  layers.forEach(({ rig, i, bright }, j) => {
    const [r, g, b] = palette[i];
    const x = `W*${rig === 0 ? 0.2 : 0.8}-w/2${rig === 0 ? "+" : "-"}W*${sweep}*sin(PI*t/${(2 * bar).toFixed(5)})`;
    const onBeat = `lt(mod(t,${beat.toFixed(5)}),${(beat * 0.3).toFixed(5)})`;
    const enable = `eq(mod(floor(t/${step.toFixed(5)})+${rig},${palette.length}),${i})*${bright ? onBeat : `not(${onBeat})`}`;
    const out = j === layers.length - 1 ? output : `[g${j}]`;
    filters.push(`[s${j}]colorchannelmixer=rr=${r.toFixed(3)}:gg=${g.toFixed(3)}:bb=${b.toFixed(3)}:aa=${bright ? 0.9 : 0.4}[c${j}]`);
    filters.push(`${last}[c${j}]overlay=x='${x}':y=H-h-300:eval=frame:shortest=1:enable='${enable}'${out}`);
    last = out;
  });
  return filters;
}

const FONTS = [
  "C:/Windows/Fonts/segoeuib.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
];

// AI backdrop via OpenAI images (gpt-image-1) if OPENAI_API_KEY is set. With album art as `reference`
// it uses /images/edits so the stage picks up the cover's colours and motifs; otherwise /images/generations.
export async function aiBackdrop(prompt: string, outPath: string, reference?: string): Promise<boolean> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
  let body: FormData | string;
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (reference) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", `${prompt} Use the colour palette and visual motifs of the attached album cover.`);
    form.append("size", "1536x1024");
    form.append("image", new Blob([fs.readFileSync(reference)], { type: reference.endsWith(".png") ? "image/png" : "image/jpeg" }), path.basename(reference));
    body = form;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify({ model, prompt, size: "1536x1024", n: 1 });
  }
  const response = await fetch(`https://api.openai.com/v1/images/${reference ? "edits" : "generations"}`, {
    method: "POST", headers, body, signal: AbortSignal.timeout(180000)
  });
  const json = await response.json() as { data?: { b64_json?: string }[]; error?: { message?: string } };
  const b64 = json.data?.[0]?.b64_json;
  if (!response.ok || !b64) throw new Error(`OpenAI image failed: ${json.error?.message ?? response.status}`);
  fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
  return true;
}

// Downloads album art (e.g. Last.fm's cover image); false if there is none or the download fails.
export async function downloadImage(url: string | undefined, outPath: string): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return false;
    fs.writeFileSync(outPath, Buffer.from(await response.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

export function backdropPrompt(title: string, tags: string[], sections: string[], about?: string): string {
  return `Cinematic wide concert stage for the song "${title}"${tags.length ? `, mood: ${tags.slice(0, 5).join(", ")}` : ""}. `
    + (about ? `About the song: ${about.slice(0, 300)} ` : "")
    + `On stage: ${sections.slice(0, 12).join(", ")}. Dramatic stage lighting, huge PA speaker stacks, no text, no logos, photorealistic.`;
}

// ffmpeg filter for a 1280x720 video: slow zoom on the backdrop, CQT spectrum, waveform, a flash on every
// beat (stronger on the downbeat), title, and a caption whenever a section enters. Text comes from files in `dir`.
export function videoFilter(plan: VideoPlan, font: string | null, dir: string): string {
  const beat = 60 / plan.bpm;
  const bar = beat * plan.beatsPerBar;
  const frames = Math.ceil((plan.durationMs / 1000) * 30);
  const text = (file: string, content: string, opts: string) => {
    fs.writeFileSync(path.join(dir, file), content);
    return font ? `,drawtext=fontfile=${font}:textfile=${file}:fontcolor=white:${opts}` : "";
  };
  const captions = plan.entrances.map((e, i) => {
    const start = (e.timeMs / 1000).toFixed(2);
    const end = (e.timeMs / 1000 + 4).toFixed(2);
    return text(`enter${i}.txt`, `${e.labels.slice(0, 3).join(" + ")}${e.labels.length > 3 ? ` + ${e.labels.length - 3} more` : ""} ${e.labels.length > 1 ? "enter" : "enters"}`,
      `fontsize=28:box=1:boxcolor=black@0.45:boxborderw=12:x=(w-tw)/2:y=h-250:enable='between(t,${start},${end})'`);
  }).join("");
  return [
    `[0:v]scale=1536:-2,zoompan=z='min(zoom+0.00015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=30,format=rgba[stage]`,
    ...galaxyBeams(plan, "[stage]", "[lit]"),
    `[lit]format=yuv420p[bg]`,
    `[1:a]showcqt=s=1280x300:fps=30:bar_v=12:sono_h=0:axis=0:bar_g=2[cqt]`,
    `[1:a]showwaves=s=1280x90:mode=cline:colors=white@0.8:rate=30[wave]`,
    `[bg][cqt]overlay=0:H-300:shortest=1[a]`,
    `[a][wave]overlay=0:H-390:shortest=1,`
      + `drawbox=x=0:y=0:w=iw:h=ih:color=white@0.12:t=fill:enable='lt(mod(t,${beat.toFixed(5)}),0.05)',`
      + `drawbox=x=0:y=0:w=iw:h=ih:color=0xff3355@0.18:t=fill:enable='lt(mod(t,${bar.toFixed(5)}),0.07)'`
      + text("title.txt", plan.title, "fontsize=44:x=40:y=36:shadowx=2:shadowy=2")
      + text("subtitle.txt", plan.subtitle, "fontsize=22:x=42:y=96:fontcolor=white@0.8")
      + `${captions}[v]`
  ].join(";");
}

export function makeVideo(audioPath: string, backdrop: string | null, plan: VideoPlan, outPath: string): void {
  const dir = path.dirname(outPath);
  const fontSrc = FONTS.find(f => fs.existsSync(f));
  let font: string | null = null;
  if (fontSrc) {
    fs.copyFileSync(fontSrc, path.join(dir, "font.ttf"));
    font = "font.ttf";
  }
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=360x720",
    "-vf", "format=rgba,geq=r=255:g=255:b=255:a='255*exp(-pow((X-W/2)/(4+(H-Y)*0.1),2))*(0.2+0.8*Y/H)'",
    "-frames:v", "1", BEAM_FILE
  ], { cwd: dir });
  const filter = videoFilter(plan, font, dir);
  fs.writeFileSync(path.join(dir, "video-filter.txt"), filter);
  const bg = backdrop
    ? ["-loop", "1", "-framerate", "30", "-i", path.basename(backdrop)]
    : ["-f", "lavfi", "-i", "color=c=0x14102a:s=1536x1024:r=30"];
  run("ffmpeg", [
    "-y", "-loglevel", "error", ...bg, "-i", path.relative(dir, audioPath),
    "-loop", "1", "-framerate", "30", "-i", BEAM_FILE,
    "-filter_complex_script", "video-filter.txt", "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "320k", "-shortest", path.basename(outPath)
  ], { cwd: dir });
  for (const f of fs.readdirSync(dir)) if (/^(enter\d+|title|subtitle)\.txt$|^font\.ttf$|^video-filter\.txt$|^beam\.png$/.test(f)) fs.rmSync(path.join(dir, f));
}

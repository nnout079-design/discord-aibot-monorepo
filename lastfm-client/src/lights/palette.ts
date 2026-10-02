import { TrackAttributes } from "../sync/entry";

export interface LightPlan {
  /** Colours (#rrggbb) the two galaxy rigs cycle through, one step per bar or two. */
  palette: string[];
  /** 0-1: how hard the rigs pulse, sweep and spin. */
  energy: number;
}

export const GALAXY_PALETTE = ["#7a00ff", "#1a3cff", "#00c8ff", "#ff2fd0"];

const MOODS: [RegExp, string[]][] = [
  [/metal|hardcore|punk|thrash/, ["#ff1a1a", "#ffffff", "#ff6a00"]],
  [/techno|house|edm|electro|dance|trance|dubstep|drum and bass|disco/, ["#00e5ff", "#ff00d4", "#7a00ff", "#00ff88"]],
  [/ambient|chill|downtempo|dream|shoegaze|lo-?fi|space/, ["#1a3cff", "#7a00ff", "#00b3ff"]],
  [/hip.?hop|rap|trap|r&b|rnb|soul|funk/, ["#ffb300", "#ff2d6f", "#8a2be2"]],
  [/jazz|blues|swing/, ["#ff9a1f", "#1f4dff", "#ffd27f"]],
  [/classical|orchestral|soundtrack|choral|opera|baroque/, ["#ffd27f", "#ffffff", "#8fb8ff"]],
  [/folk|country|acoustic|celtic|world|afro|latin|reggae|bangla|balkan|bollywood/, ["#ffb347", "#3cb371", "#ff6347"]],
  [/pop/, ["#ff4fa3", "#ffe14f", "#4fd8ff"]],
  [/rock|alternative|grunge|indie/, ["#ff3b1f", "#ff9f1a", "#3b5bff"]]
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Colours from the song's Last.fm tags, artist tags and genres; energy from danceability, or tempo when unknown.
export function lightPlan(track: TrackAttributes | null, bpm: number): LightPlan {
  const tags = [...(track?.tags ?? []), ...(track?.artistTags ?? []), ...(track?.genres ?? [])].map(tag => tag.toLowerCase());
  const palette = MOODS.find(([pattern]) => tags.some(tag => pattern.test(tag)))?.[1] ?? GALAXY_PALETTE;
  let energy = track?.danceability !== undefined ? track.danceability / 100 : (bpm - 60) / 120;
  if ((track?.acousticness ?? 0) >= 60) energy -= 0.2;
  return { palette, energy: Math.round(clamp(energy, 0.2, 1) * 100) / 100 };
}

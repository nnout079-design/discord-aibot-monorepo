// Two on-screen galaxy rigs. rigFrame is the same logic as src/lights/show.ts, applied to the `show`
// the companion sends with each song entry, so the screen moves with the DMX rigs and the MIDI.
const IDLE = { r: 0.48, g: 0, b: 1, w: 0, dimmer: 0.12, pan: 0.5, tilt: 0.5 };
const BLACKOUT = { r: 0, g: 0, b: 0, w: 0, dimmer: 0, pan: 0.5, tilt: 0.5 };

function rigFrame(show, rig, now) {
  const { palette, energy, beatMs, beatsPerBar } = show;
  const colour = step => palette[(step + rig) % palette.length];
  if (show.endAt !== null && now >= show.endAt) return BLACKOUT;
  if (now < show.countInAt) {
    const [r, g, b] = colour(0);
    return { r, g, b, w: 0, dimmer: 0.12, pan: 0.5, tilt: 0.5 };
  }
  if (now < show.startAt) {
    const phase = ((now - show.countInAt) % beatMs) / beatMs;
    return { r: 0, g: 0, b: 0, w: 1, dimmer: 0.15 + 0.85 * Math.exp(-phase * 6), pan: 0.5, tilt: 0.5 };
  }
  const beats = (now - show.startAt) / beatMs;
  const beat = Math.floor(beats);
  const phase = beats - beat;
  const bar = Math.floor(beat / beatsPerBar);
  const bars = beats / beatsPerBar;
  const [r, g, b] = colour(Math.floor(bar / (energy >= 0.7 ? 1 : 2)));
  const base = 0.3 + 0.3 * (1 - energy);
  const kick = (beat % beatsPerBar === 0 ? 1 : 0.6) * Math.exp(-phase * 5);
  const side = rig % 2 === 0 ? 1 : -1;
  const state = {
    r, g, b, w: 0,
    dimmer: base + (1 - base) * kick,
    pan: 0.5 + side * (0.15 + 0.15 * energy) * Math.sin((Math.PI * bars) / 2),
    tilt: 0.5 + 0.15 * Math.sin((Math.PI * bars) / 4 + rig * Math.PI / 2)
  };
  if (show.accents.some(at => now >= at && now < at + beatMs)) {
    state.w = 1;
    state.dimmer = Math.floor(now / 50) % 2 === 0 ? 1 : 0;
  }
  return state;
}

const STARS = 420;
const starCache = new Map();

function stars(seed) {
  if (!starCache.has(seed)) {
    let x = seed * 9301 + 49297;
    const rand = () => (x = (x * 9301 + 49297) % 233280) / 233280;
    starCache.set(seed, Array.from({ length: STARS }, (_, i) => {
      const radius = Math.pow(rand(), 0.6);
      return { radius, angle: (i % 2) * Math.PI + radius * 5 + (rand() - 0.5) * 0.9, size: rand() < 0.08 ? 2 : 1, twinkle: rand() * 6.28 };
    }));
  }
  return starCache.get(seed);
}

function drawGalaxy(canvas, state, now, energy, rig) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const mix = c => Math.round(255 * Math.min(1, c + state.w));
  const rgb = `${mix(state.r)}, ${mix(state.g)}, ${mix(state.b)}`;
  const level = 0.2 + 0.8 * state.dimmer;
  ctx.fillStyle = "#05030f";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.42;
  const spin = (now / 1000) * (0.05 + 0.3 * energy) * (rig % 2 === 0 ? 1 : -1);
  for (const star of stars(rig + 1)) {
    const a = star.angle + spin * (1.4 - star.radius);
    const x = cx + Math.cos(a) * star.radius * w * 0.45;
    const y = cy + Math.sin(a) * star.radius * h * 0.32;
    ctx.fillStyle = `rgba(${rgb}, ${level * (0.35 + 0.65 * Math.abs(Math.sin(now / 700 + star.twinkle)))})`;
    ctx.fillRect(x, y, star.size, star.size);
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * (0.15 + 0.25 * state.dimmer));
  core.addColorStop(0, `rgba(255, 255, 255, ${0.8 * state.dimmer})`);
  core.addColorStop(0.3, `rgba(${rgb}, ${0.6 * state.dimmer})`);
  core.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, w, h);

  // The rig's beam from the floor, aimed by pan and tilt.
  const tx = w * state.pan;
  const ty = h * (1 - state.tilt) * 0.8;
  const spread = w * 0.07;
  const beam = ctx.createLinearGradient(cx, h, tx, ty);
  beam.addColorStop(0, `rgba(${rgb}, ${0.9 * state.dimmer})`);
  beam.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(cx - 3, h);
  ctx.lineTo(tx - spread, ty);
  ctx.lineTo(tx + spread, ty);
  ctx.lineTo(cx + 3, h);
  ctx.fill();
}

function drawRigs(entry, now) {
  const show = entry?.show;
  ["rigA", "rigB"].forEach((id, rig) => {
    const canvas = document.getElementById(id);
    if (canvas) drawGalaxy(canvas, show ? rigFrame(show, rig, now) : IDLE, now, show?.energy ?? 0.3, rig);
  });
}

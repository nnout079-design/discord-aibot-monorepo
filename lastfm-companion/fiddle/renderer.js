const el = id => document.getElementById(id);
const FLASH_MS = 150;
let entry = null;
const SOURCES = { file: "Your MIDI file", lakh: "Lakh MIDI", transcribed: "Transcribed audio", generated: "Generated arrangement" };

function show(label, big, flash = 0, color = "#ffffff") {
  el("label").textContent = label;
  el("big").textContent = big;
  el("flash").style.background = color;
  el("flash").style.opacity = String(flash * 0.6);
}

window.sync.status().then(status => (el("status").textContent = status));

window.sync.onEvent(event => {
  if (event.type === "song-entry") {
    entry = event;
    el("track").textContent = event.track ? `${event.track.artist} - ${event.track.name}` : event.pattern ?? "song entry";
    el("bpm").textContent = `${event.bpm.toFixed(1)} BPM, ${event.beatsPerBar} beats per bar`;
    const arrangement = event.arrangement;
    el("source").textContent = arrangement ? `${SOURCES[arrangement.source] ?? arrangement.source}, ${arrangement.sections.length} sections` : "";
    el("sections").replaceChildren(...(arrangement?.sections ?? []).map(name => {
      const chip = document.createElement("span");
      chip.textContent = name;
      return chip;
    }));
  } else if (event.type === "song-stop") {
    entry = null;
    show("Stopped", "–");
    el("sections").classList.remove("live");
  }
});

// Times in `local` are already converted to this PC's clock by the companion.
function frame() {
  requestAnimationFrame(frame);
  drawRigs(entry, Date.now());
  if (!entry) return;
  const { countInAt, startAt, endAt } = entry.local ?? entry;
  const { beatMs, beatsPerBar } = entry;
  const now = Date.now();

  if (endAt && now >= endAt) {
    entry = null;
    show("Ended", "–");
    el("sections").classList.remove("live");
  } else if (now < countInAt) {
    show("Get ready", `${((startAt - now) / 1000).toFixed(1)}s`);
  } else if (now < startAt) {
    const beat = Math.floor((now - countInAt) / beatMs);
    const phase = (now - countInAt) % beatMs;
    show("Count-in", String(beat + 1), Math.max(0, 1 - phase / FLASH_MS), "#ffcc00");
  } else {
    const beats = Math.floor((now - startAt) / beatMs);
    const bar = Math.floor(beats / beatsPerBar) + 1;
    const beatInBar = (beats % beatsPerBar) + 1;
    const phase = (now - startAt) % beatMs;
    const downbeat = beatInBar === 1;
    el("sections").classList.add("live");
    el("sections").style.setProperty("--pulse", String(Math.max(0, 1 - phase / (beatMs * 0.8))));
    show("Playing", `${bar}.${beatInBar}`, Math.max(0, 1 - phase / FLASH_MS) * (downbeat ? 1 : 0.4), downbeat ? "#ff3355" : "#ffffff");
  }
}
requestAnimationFrame(frame);

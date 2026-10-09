import * as dotenv from "dotenv";
import fs from "node:fs";
import { listOutputs } from "./midi";
import { DEFAULT_RIG, loadRig } from "./rig";

dotenv.config();

// `npm run rig` shows where each section goes; `npm run rig -- --write` saves the built-in rig as rig.json to edit.
const file = process.env.RIG_FILE ?? "rig.json";
if (process.argv.includes("--write")) {
  if (fs.existsSync(file)) {
    console.log(`${file} already exists; not overwriting it.`);
  } else {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_RIG, null, 2) + "\n");
    console.log(`Wrote ${file}. Edit port names, channels, programs and latencyMs, then restart npm start.`);
  }
}
const rig = loadRig(file);
const outputs = listOutputs();
const fallback = process.env.MIDI_OUTPUT ?? "loopMIDI";
const found = (name: string) => outputs.find(port => port.toLowerCase().includes(name.toLowerCase()));
console.log(`MIDI outputs: ${outputs.join(", ") || "none"}\n`);
for (const [key, name] of Object.entries(rig.ports)) {
  const port = found(name);
  console.log(`${key.padEnd(10)} "${name}" -> ${port ?? (key === rig.djPort ? "not found (DJ booth off)" : `not found, using ${fallback} on compact channels`)}`);
}
console.log("");
let group = "";
for (const [name, s] of Object.entries(rig.sections)) {
  if (s.group !== group) console.log(`\n${(group = s.group)}`);
  const port = found(rig.ports[s.port]);
  const where = port ? `${s.port} ch ${s.channel}` : `${fallback} ch ${s.compactChannel}`;
  const sound = s.drums ? "drums" : `program ${s.program ?? "-"}`;
  console.log(`  ${s.label.padEnd(20)} ${name.padEnd(16)} ${where.padEnd(28)} ${sound}${s.latencyMs ? `, ${s.latencyMs} ms early` : ""}`);
}

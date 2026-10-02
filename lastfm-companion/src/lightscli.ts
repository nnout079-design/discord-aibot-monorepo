import * as dotenv from "dotenv";
import fs from "node:fs";
import { DEFAULT_LIGHTS, loadLights } from "./lights/config";
import { LightEngine } from "./lights/engine";
import { PROFILES } from "./lights/fixtures";
import { dmxPorts, openDmx } from "./lights/output";
import { buildShow, GALAXY_PALETTE } from "./lights/show";

dotenv.config();

const DEMO_BPM = 120;
const DEMO_BARS = 8;

// `npm run lights -- --write` saves lights.json to edit, `npm run lights ports` lists USB-DMX ports,
// `npm run lights test` plays an 8-bar demo show on the two galaxy rigs.
async function main(): Promise<void> {
  const file = process.env.LIGHTS_FILE ?? "lights.json";
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    if (fs.existsSync(file)) console.log(`${file} already exists; not overwriting it.`);
    else {
      fs.writeFileSync(file, JSON.stringify(DEFAULT_LIGHTS, null, 2) + "\n");
      console.log(`Wrote ${file}. Set "output", the fixture "profile"s and DMX "address"es, then restart npm start.`);
    }
  }
  if (args.includes("ports")) {
    const ports = await dmxPorts();
    console.log(ports.length ? ports.map(p => `${p.path}  ${p.label}${p.likely ? "  <- looks like a DMX adapter" : ""}`).join("\n") : "No serial/USB ports found.");
    return;
  }
  const config = loadLights(file);
  if (!config) {
    console.log(`No ${file}. Run: npm run lights -- --write`);
    return;
  }
  console.log(`Output: ${config.output}${config.output === "artnet" ? ` ${config.host} universe ${config.universe}` : config.port ? ` ${config.port}` : ""}`);
  for (const f of config.fixtures) {
    console.log(`  ${f.name.padEnd(12)} rig ${f.rig === 0 ? "A" : "B"}  ${PROFILES[f.profile].label}, DMX ${f.address}-${f.address + PROFILES[f.profile].channels - 1}`);
  }
  if (!args.includes("test")) {
    console.log("\nnpm run lights test   plays an 8-bar demo on the rigs");
    return;
  }
  const log = (message: string) => console.log(message);
  const out = await openDmx(config, log);
  if (!out) {
    console.log('output is "none"; set it in lights.json to test.');
    return;
  }
  const beatMs = 60000 / DEMO_BPM;
  const countInAt = Date.now() + 1000;
  const startAt = countInAt + beatMs * 4;
  const endAt = startAt + beatMs * 4 * DEMO_BARS;
  const engine = new LightEngine(config, out);
  engine.load(buildShow({ beatMs, beatsPerBar: 4, lights: { palette: GALAXY_PALETTE, energy: 0.8 } }, { countInAt, startAt, endAt }, [startAt, startAt + beatMs * 16]));
  console.log(`Demo on ${out.name}: count-in, then ${DEMO_BARS} bars at ${DEMO_BPM} BPM`);
  await new Promise(resolve => setTimeout(resolve, endAt - Date.now() + 500));
  engine.close();
  console.log("Done (blackout).");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

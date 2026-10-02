export interface SyncArgs {
  action: "start" | "stop";
  body: { pattern?: string; bpm?: number; lead?: number; beats?: number; username?: string };
}

const NUMERIC = new Set(["bpm", "lead", "beats"]);

// `npm run sync afrobeat 120 lead=4 user=rj` or `npm run sync stop`.
export function parseSyncArgs(argv: string[]): SyncArgs {
  const body: SyncArgs["body"] = {};
  let action: SyncArgs["action"] = "start";
  for (const raw of argv) {
    const arg = raw.replace(/^--?/, "");
    const [key, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")).toLowerCase(), arg.slice(arg.indexOf("=") + 1)] : ["", arg];
    if (!key && value.toLowerCase() === "stop") action = "stop";
    else if (!key && /^\d+(\.\d+)?$/.test(value)) body.bpm = Number(value);
    else if (!key) body.pattern = value.toLowerCase();
    else if (NUMERIC.has(key)) {
      if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`${key} must be a number`);
      body[key as "bpm" | "lead" | "beats"] = Number(value);
    } else if (key === "pattern") body.pattern = value.toLowerCase();
    else if (key === "user" || key === "username") body.username = value;
    else throw new Error(`Unknown option "${raw}". Use: npm run sync [pattern] [bpm] [lead=SECONDS] [beats=N] [user=LASTFM_NAME], or npm run sync stop`);
  }
  return { action, body };
}

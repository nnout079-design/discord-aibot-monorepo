export function createSseParser(onEvent: (type: string, data: string) => void): (chunk: string) => void {
  let buffer = "";
  return chunk => {
    buffer += chunk.replace(/\r/g, "");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let type = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") type = value;
        else if (field === "data") data.push(value);
      }
      if (data.length > 0) onEvent(type, data.join("\n"));
    }
  };
}

export class TokenRejectedError extends Error {}

const STALE_MS = 45000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Holds one outbound Server-Sent Events connection to the bot, reconnecting with backoff.
export async function subscribe(
  botUrl: string,
  token: string,
  onEvent: (type: string, data: string) => void,
  log: (message: string) => void
): Promise<never> {
  let backoffMs = 1000;
  for (;;) {
    const abort = new AbortController();
    let watchdog = setTimeout(() => abort.abort(), STALE_MS);
    try {
      const response = await fetch(`${botUrl}/sync/events`, {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: abort.signal
      });
      if (response.status === 401) throw new TokenRejectedError("The bot rejected COMPANION_TOKEN. Run /companion in Discord for the current one.");
      if (!response.ok || !response.body) throw new Error(`/sync/events returned ${response.status}`);
      log("Connected to bot, waiting for /sync");
      backoffMs = 1000;
      const parse = createSseParser(onEvent);
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => abort.abort(), STALE_MS);
        parse(decoder.decode(value, { stream: true }));
      }
      log("Disconnected from bot");
    } catch (error) {
      if (error instanceof TokenRejectedError) throw error;
      log(`Connection problem: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(watchdog);
    }
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, 30000);
  }
}

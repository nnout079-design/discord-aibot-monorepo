import crypto from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import { SongEntryEvent, SongStopEvent } from "./entry";

type HubEvent = SongEntryEvent | SongStopEvent;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();

function writeEvent(res: http.ServerResponse, event: HubEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

// Companions on users' PCs connect out to GET /sync/events (Server-Sent Events) and
// align their clocks with GET /sync/time, so they never need a public URL of their own.
export class CompanionHub {
  private clients = new Set<http.ServerResponse>();
  private armed: SongEntryEvent | null = null;
  private server = http.createServer((req, res) => this.handle(req, res));
  private ping: NodeJS.Timeout | null = null;

  constructor(private tokenOverride?: string) {}

  get connected(): number {
    return this.clients.size;
  }

  get token(): string {
    return this.tokenOverride ?? process.env.COMPANION_TOKEN ?? "";
  }

  listen(port: number): Promise<number> {
    this.ping ??= setInterval(() => this.clients.forEach(res => res.write(": ping\n\n")), 15000);
    return new Promise(resolve => this.server.listen(port, () => resolve((this.server.address() as AddressInfo).port)));
  }

  close(): Promise<void> {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    this.clients.forEach(res => res.end());
    this.clients.clear();
    return new Promise(resolve => this.server.close(() => resolve()));
  }

  publish(event: HubEvent): void {
    this.armed = event.type === "song-entry" ? event : null;
    this.clients.forEach(res => writeEvent(res, event));
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    return crypto.timingSafeEqual(sha256(given), sha256(this.token));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { pathname } = new URL(req.url ?? "/", "http://hub");
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    if (pathname === "/health") {
      res.end("ok");
      return;
    }
    if (pathname === "/sync/time") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ now: Date.now() }));
      return;
    }
    if (pathname === "/sync/events") {
      if (!this.token) {
        res.writeHead(503).end("COMPANION_TOKEN is not configured on the bot");
        return;
      }
      if (!this.authorized(req)) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
      if (this.armed && this.armed.startAt > Date.now()) writeEvent(res, this.armed);
      return;
    }
    res.writeHead(404).end();
  }
}

export const companionHub = new CompanionHub();

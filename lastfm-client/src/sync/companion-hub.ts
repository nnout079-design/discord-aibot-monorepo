import crypto from "node:crypto";
import http from "node:http";
import { AddressInfo } from "node:net";
import { SongEntryEvent, SongStopEvent } from "./entry";

type HubEvent = SongEntryEvent | SongStopEvent;

export interface ControlResult {
  status: number;
  body: object;
}

export type ControlAction = "start" | "stop" | "now-playing";

export type ControlHandler = (action: ControlAction, body: unknown) => Promise<ControlResult>;

const MAX_BODY_BYTES = 4096;

const CONTROL_PATHS: Record<string, ControlAction> = { "/sync/start": "start", "/sync/stop": "stop", "/sync/now-playing": "now-playing" };

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();

function sendJson(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeEvent(res: http.ServerResponse, event: HubEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

// Companions on users' PCs connect out to GET /sync/events (Server-Sent Events) and
// align their clocks with GET /sync/time, so they never need a public URL of their own.
// POST /sync/start, /sync/stop and /sync/now-playing let a companion arm, stop or look up an entry without Discord.
export class CompanionHub {
  private clients = new Set<http.ServerResponse>();
  private armed: SongEntryEvent | null = null;
  private server = http.createServer((req, res) => this.handle(req, res));
  private ping: NodeJS.Timeout | null = null;
  private control: ControlHandler | null = null;

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

  setControl(handler: ControlHandler): void {
    this.control = handler;
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

  private async handleControl(action: ControlAction, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.token) {
      sendJson(res, 503, { error: "COMPANION_TOKEN is not configured on the bot" });
      return;
    }
    if (!this.authorized(req)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (!this.control) {
      sendJson(res, 503, { error: "sync control is not available" });
      return;
    }
    let body: unknown;
    try {
      const text = await readBody(req);
      body = text.trim() ? JSON.parse(text) : {};
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "invalid body" });
      return;
    }
    try {
      const result = await this.control(action, body);
      sendJson(res, result.status, result.body);
    } catch (error) {
      console.error(`Companion /sync/${action} failed:`, error);
      sendJson(res, 500, { error: "sync control failed" });
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { pathname } = new URL(req.url ?? "/", "http://hub");
    const action = CONTROL_PATHS[pathname];
    if (req.method === "POST" && action) {
      void this.handleControl(action, req, res);
      return;
    }
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

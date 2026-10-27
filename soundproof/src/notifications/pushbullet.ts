export interface PushbulletPush {
  title: string;
  body: string;
  deviceIden?: string;
}

export interface PushbulletResult {
  sent: boolean;
  status: "sent" | "disabled" | "deduplicated" | "rate-limited" | "failed";
  iden?: string;
  retryAfterSeconds?: number;
}

interface PushbulletUser {
  iden: string;
  name?: string;
  max_upload_size?: number;
}

const API_URL = "https://api.pushbullet.com/v2";
const lastPushByKey = new Map<string, number>();

function token(): string | undefined {
  return process.env.PUSHBULLET_API_TOKEN;
}

function retryDelay(response: Response, attempt: number): number {
  const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000;
  if (response.status === 429 && reset > Date.now()) return Math.min(reset - Date.now(), 60_000);
  return Math.min(1000 * 2 ** attempt, 8000);
}

async function request(path: string, init: RequestInit, attempts = 3): Promise<Response> {
  const accessToken = token();
  if (!accessToken) throw new Error("PUSHBULLET_API_TOKEN is not configured");
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Access-Token": accessToken, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(10_000)
    });
    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, retryDelay(response!, attempt)));
  }
  return response!;
}

export async function getPushbulletStatus(): Promise<{ configured: boolean; connected: boolean; account?: string; error?: string }> {
  if (!token()) return { configured: false, connected: false };
  try {
    const response = await request("/users/me", { method: "GET", headers: {} }, 1);
    if (!response.ok) return { configured: true, connected: false, error: `HTTP ${response.status}` };
    const user = await response.json() as PushbulletUser;
    return { configured: true, connected: true, account: user.name ?? user.iden };
  } catch (error) {
    return { configured: true, connected: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function sendPushbulletNote(push: PushbulletPush, dedupeKey?: string, cooldownMs = 120_000): Promise<PushbulletResult> {
  if (!token()) return { sent: false, status: "disabled" };
  if (dedupeKey) {
    const lastPush = lastPushByKey.get(dedupeKey) ?? 0;
    if (Date.now() - lastPush < cooldownMs) return { sent: false, status: "deduplicated" };
  }
  try {
    const response = await request("/pushes", {
      method: "POST",
      body: JSON.stringify({
        type: "note",
        title: push.title.slice(0, 100),
        body: push.body.slice(0, 4000),
        device_iden: push.deviceIden ?? process.env.PUSHBULLET_DEVICE_IDEN ?? undefined
      })
    });
    if (response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0);
      return { sent: false, status: "rate-limited", ...(reset ? { retryAfterSeconds: Math.max(0, reset - Math.floor(Date.now() / 1000)) } : {}) };
    }
    if (!response.ok) return { sent: false, status: "failed" };
    const result = await response.json() as { iden?: string };
    if (dedupeKey) lastPushByKey.set(dedupeKey, Date.now());
    return { sent: true, status: "sent", iden: result.iden };
  } catch (error) {
    console.error("Pushbullet notification failed:", error instanceof Error ? error.message : "Unknown error");
    return { sent: false, status: "failed" };
  }
}

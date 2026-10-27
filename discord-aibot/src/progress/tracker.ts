import * as fs from "fs";
import * as path from "path";

export interface ActivityEntry {
	timestamp: number;
	bot: string;
	action: string;
	detail: string;
	xp: number;
}

export interface UserProgress {
	xp: number;
	totals: Record<string, number>;
	activities: ActivityEntry[];
}

export interface GuildEvent {
	timestamp: number;
	action: string;
	detail: string;
}

interface ProgressFile {
	users: Record<string, UserProgress>;
	guildEvents: Record<string, GuildEvent[]>;
}

const XP_TABLE: Record<string, number> = {
	wellness: 10,
	ask: 10,
	reason: 10,
	bertcase: 5,
	help: 1,
	airhorn: 3,
	listen: 5,
	lastfm: 5,
	sync: 5,
	percussion: 5,
	companion: 5,
	stream: 5,
	game: 10,
	progress: 1,
};

const MAX_ACTIVITIES = 200;
const MAX_GUILD_EVENTS = 200;
const KEY_PREFIX = "progress";

// American Psycho reward tiers, ordered by XP required.
export const TIERS = [
	{
		xp: 0,
		name: "Silian Rail on Bone",
		detail: "Your first card. Bone coloring, Silian Rail typeface. Bateman thought it was lovely — everyone else barely looked.",
	},
	{
		xp: 25,
		name: "Romalian Type on Eggshell",
		detail: "Van Patten's card. Eggshell stock, Romalian type. A noticeable improvement. People pick it up now.",
	},
	{
		xp: 75,
		name: "Raised Lettering, Pale Nimbus White",
		detail: "McDermott's card. Raised lettering on Pale Nimbus White. You can hear the quiet envy at the conference table.",
	},
	{
		xp: 200,
		name: "Tasteful Thickness, Subtle Off-White, Watermark",
		detail: "Paul Allen's card. The subtle off-white coloring, the tasteful thickness — oh my god, it even has a watermark. Includes a standing 8:30 reservation attempt at Dorsia (great sea urchin ceviche).",
	},
	{
		xp: 500,
		name: "Vice President, Pierce & Pierce",
		detail: "Mergers & Acquisitions — or is it Murders & Executions? The same typo is on everyone's card. Yours included.",
	},
	{
		xp: 1000,
		name: "Impeccable",
		detail: "The top tier. You have achieved perfection of surface. Reward unlocked: permission to return some videotapes.",
	},
];

const botName = path.basename(process.cwd()) || "bot";

// ---------- Redis backend (shared across bots when REDIS_URL is set) ----------

type RedisClient = {
	hget(key: string, field: string): Promise<string | null>;
	hincrby(key: string, field: string, increment: number): Promise<number>;
	hgetall(key: string): Promise<Record<string, string>>;
	zadd(key: string, score: number, member: string): Promise<number>;
	zrevrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]>;
	lpush(key: string, value: string): Promise<number>;
	lrange(key: string, start: number, stop: number): Promise<string[]>;
	ltrim(key: string, start: number, stop: number): Promise<string>;
};

let redis: RedisClient | undefined;
let redisFailed = false;

async function getRedis(): Promise<RedisClient | undefined> {
	if (redis || redisFailed || !process.env.REDIS_URL) {
		return redis;
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { Redis } = require("ioredis") as { Redis: new (url: string, opts?: object) => RedisClient };
		const client = new Redis(process.env.REDIS_URL, {
			lazyConnect: true,
			maxRetriesPerRequest: 2,
			enableOfflineQueue: false,
			...(process.env.REDIS_URL.startsWith("rediss://") ? { tls: {} } : {}),
		});
		await client.lpush(`${KEY_PREFIX}:__ping__`, "1");
		await client.ltrim(`${KEY_PREFIX}:__ping__`, 0, 0);
		redis = client;
		console.log("Progress tracker: Redis backend connected");
	} catch (error) {
		redisFailed = true;
		console.error("Progress tracker: Redis unavailable, using file backend:", error);
	}
	return redis;
}

const userKey = (guildId: string, userId: string) => `${KEY_PREFIX}:user:${guildId}:${userId}`;
const actKey = (guildId: string, userId: string) => `${KEY_PREFIX}:act:${guildId}:${userId}`;
const lbKey = (guildId: string) => `${KEY_PREFIX}:lb:${guildId}`;
const guildEventsKey = (guildId: string) => `${KEY_PREFIX}:events:${guildId}`;

// ---------- File backend (local dev / no REDIS_URL) ----------

const storePath = process.env.PROGRESS_DATA_PATH ?? path.join("data", "progress.json");
let store: ProgressFile | undefined;
let writeTimer: NodeJS.Timeout | undefined;

function load(): ProgressFile {
	if (store) {
		return store;
	}
	try {
		store = JSON.parse(fs.readFileSync(storePath, "utf8")) as ProgressFile;
	} catch {
		store = { users: {}, guildEvents: {} };
	}
	store.users = store.users ?? {};
	store.guildEvents = store.guildEvents ?? {};
	return store;
}

function persist(): void {
	if (writeTimer) {
		return;
	}
	writeTimer = setTimeout(() => {
		writeTimer = undefined;
		try {
			fs.mkdirSync(path.dirname(storePath), { recursive: true });
			fs.writeFileSync(storePath, JSON.stringify(store ?? { users: {}, guildEvents: {} }, null, 2));
		} catch (error) {
			console.error("Failed to persist progress store:", error);
		}
	}, 250);
}

// ---------- Public API ----------

export function recordActivity(guildId: string, userId: string, action: string, detail = ""): void {
	const xp = XP_TABLE[action] ?? 2;
	const entry: ActivityEntry = { timestamp: Date.now(), bot: botName, action, detail, xp };

	getRedis()
		.then(async r => {
			if (r) {
				const xpKey = userKey(guildId, userId);
				await r.hincrby(xpKey, "xp", xp);
				const newXp = await r.hincrby(xpKey, "xp", 0);
				await r.hincrby(`${xpKey}:totals`, action, 1);
				await r.lpush(actKey(guildId, userId), JSON.stringify(entry));
				await r.ltrim(actKey(guildId, userId), 0, MAX_ACTIVITIES - 1);
				await r.zadd(lbKey(guildId), newXp, userId);
				return;
			}
			const data = load();
			const id = `${guildId}:${userId}`;
			const p = data.users[id] ?? { xp: 0, totals: {}, activities: [] };
			p.xp += xp;
			p.totals[action] = (p.totals[action] ?? 0) + 1;
			p.activities.push(entry);
			if (p.activities.length > MAX_ACTIVITIES) {
				p.activities = p.activities.slice(-MAX_ACTIVITIES);
			}
			data.users[id] = p;
			persist();
		})
		.catch(error => console.error("recordActivity failed:", error));
}

export function recordGuildEvent(guildId: string, action: string, detail: string): void {
	const event: GuildEvent = { timestamp: Date.now(), action, detail };

	getRedis()
		.then(async r => {
			if (r) {
				await r.lpush(guildEventsKey(guildId), JSON.stringify(event));
				await r.ltrim(guildEventsKey(guildId), 0, MAX_GUILD_EVENTS - 1);
				return;
			}
			const data = load();
			const events = data.guildEvents[guildId] ?? [];
			events.push(event);
			data.guildEvents[guildId] = events.slice(-MAX_GUILD_EVENTS);
			persist();
		})
		.catch(error => console.error("recordGuildEvent failed:", error));
}

export async function getProgress(guildId: string, userId: string): Promise<UserProgress> {
	const r = await getRedis();
	if (r) {
		const xp = Number((await r.hget(userKey(guildId, userId), "xp")) ?? 0);
		const rawTotals = await r.hgetall(`${userKey(guildId, userId)}:totals`);
		const totals: Record<string, number> = {};
		for (const [k, v] of Object.entries(rawTotals)) {
			totals[k] = Number(v);
		}
		const raw = await r.lrange(actKey(guildId, userId), 0, -1);
		return {
			xp,
			totals,
			activities: raw.map(s => JSON.parse(s) as ActivityEntry).reverse(),
		};
	}
	return load().users[`${guildId}:${userId}`] ?? { xp: 0, totals: {}, activities: [] };
}

export function getTier(xp: number): { index: number; current: (typeof TIERS)[number]; next?: (typeof TIERS)[number] } {
	let index = 0;
	for (let i = 0; i < TIERS.length; i++) {
		if (xp >= TIERS[i].xp) {
			index = i;
		}
	}
	return { index, current: TIERS[index], next: TIERS[index + 1] };
}

export async function getLeaderboard(guildId: string, limit = 10): Promise<{ userId: string; xp: number }[]> {
	const r = await getRedis();
	if (r) {
		const raw = await r.zrevrange(lbKey(guildId), 0, limit - 1, "WITHSCORES");
		const rows: { userId: string; xp: number }[] = [];
		for (let i = 0; i + 1 < raw.length; i += 2) {
			rows.push({ userId: raw[i], xp: Number(raw[i + 1]) });
		}
		return rows;
	}
	return Object.entries(load().users)
		.filter(([id]) => id.startsWith(`${guildId}:`))
		.map(([id, p]) => ({ userId: id.split(":")[1], xp: p.xp }))
		.sort((a, b) => b.xp - a.xp)
		.slice(0, limit);
}

export async function findImprovements(guildId: string, userId: string, query: string): Promise<ActivityEntry[]> {
	const { activities } = await getProgress(guildId, userId);
	const q = query.trim().toLowerCase();
	const matched =
		!q || q === "improvements" || q === "all"
			? activities
			: activities.filter(a => `${a.action} ${a.bot} ${a.detail}`.toLowerCase().includes(q));
	return matched.slice(-15).reverse();
}

export async function findGuildEvents(guildId: string, query: string): Promise<GuildEvent[]> {
	let events: GuildEvent[];
	const r = await getRedis();
	if (r) {
		const raw = await r.lrange(guildEventsKey(guildId), 0, -1);
		events = raw.map(s => JSON.parse(s) as GuildEvent).reverse();
	} else {
		events = load().guildEvents[guildId] ?? [];
	}
	const q = query.trim().toLowerCase();
	const matched = !q ? events : events.filter(e => `${e.action} ${e.detail}`.toLowerCase().includes(q));
	return matched.slice(-15).reverse();
}

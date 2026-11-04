/**
 * Moderation bot for the Visible Vapor / Socialize server.
 *
 * Covers the offences observed in #socialize plus the `.quote` bypass:
 * AutoMod cannot filter messages sent by bots, so a user can invoke
 * `.quote` on the Socialize Fun bot and have it repost content that
 * would otherwise be blocked. This bot watches `.quote` invocations,
 * re-scans the quote the game bot posts, and holds the invoker
 * responsible for what it surfaces.
 *
 * Escalation:
 *   CRITICAL -> delete + 1h timeout + alert
 *   HIGH     -> delete + warn; 2nd offence -> 10m timeout
 *   MEDIUM   -> delete + warn; 3rd warn -> 10m timeout
 *   LOW      -> flag to mod channel only
 *
 * Requires the Message Content privileged intent in the dev portal.
 * Bot needs: Manage Messages, Moderate Members, Send Messages.
 */

import * as dotenv from 'dotenv';
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  Guild,
  GuildMember,
  Message,
} from 'discord.js';
import { scan, OffenceTier } from './scanner';

dotenv.config();

// Non-logging moderation: no mod-log channel and no stored offence records.
// Warn counts are in-memory only and reset on restart.
const SOCIALIZE_BOT_ID = process.env.SOCIALIZE_BOT_ID ?? '';

const QUOTE_WINDOW_MS = 20_000;
const HIGH_WARN_TIMEOUT_AT = 2;
const MEDIUM_WARN_TIMEOUT_AT = 3;
const HIGH_TIMEOUT_MS = 10 * 60_000;
const MEDIUM_TIMEOUT_MS = 10 * 60_000;
const CRITICAL_TIMEOUT_MS = 60 * 60_000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// userId -> { HIGH: n, MEDIUM: n }
const warnCounts = new Map<string, Partial<Record<OffenceTier, number>>>();

// channelId -> recent .quote invocations
interface QuoteInvocation {
  ts: number;
  member: GuildMember;
}
const quoteInvocations = new Map<string, QuoteInvocation[]>();

async function log(_guild: Guild, text: string): Promise<void> {
  console.log(`[modbot] ${text}`);
}

async function tryDelete(message: Message): Promise<void> {
  await message.delete().catch(() => {});
}

function bumpWarn(userId: string, tier: OffenceTier): number {
  const w = warnCounts.get(userId) ?? {};
  w[tier] = (w[tier] ?? 0) + 1;
  warnCounts.set(userId, w);
  return w[tier]!;
}

async function handleOffence(
  member: GuildMember,
  message: Message,
  tier: OffenceTier,
  source: string,
): Promise<void> {
  await log(
    message.guild!,
    `${tier} offence by ${member.id} in #${(message.channel as { name?: string }).name ?? message.channel.id} (${source})`,
  );

  if (tier === 'LOW') return; // flag only

  await tryDelete(message);

  if (tier === 'CRITICAL') {
    await member
      .timeout(CRITICAL_TIMEOUT_MS, `AutoMod: ${tier} offence`)
      .catch(() => log(message.guild!, `Could not timeout ${member} (missing perms)`));
    return;
  }

  const count = bumpWarn(member.id, tier);
  const limit = tier === 'HIGH' ? HIGH_WARN_TIMEOUT_AT : MEDIUM_WARN_TIMEOUT_AT;
  const duration = tier === 'HIGH' ? HIGH_TIMEOUT_MS : MEDIUM_TIMEOUT_MS;

  const channel = message.channel;
  if (!channel.isSendable()) return;

  if (count >= limit) {
    await member.timeout(duration, `AutoMod: ${tier} offence #${count}`).catch(() => {});
    const notice = await channel
      .send(`${member} timed out (${tier} offence #${count}).`)
      .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 15_000);
  } else {
    const notice = await channel
      .send(`${member} warning ${count}/${limit}: message removed (${tier} offence).`)
      .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 15_000);
  }
}

function isExempt(member: GuildMember): boolean {
  const p = member.permissions;
  return (
    p.has(PermissionFlagsBits.ManageMessages) ||
    p.has(PermissionFlagsBits.Administrator)
  );
}

const QUOTE_CMD = /^\s*[.!-]?q(uote)?\b/i;

client.on('messageCreate', async (message: Message) => {
  if (!message.guild || message.author.id === client.user?.id) return;

  // 1) Member messages: scan directly.
  if (!message.author.bot) {
    const member = message.member;
    if (!member || isExempt(member)) return;

    if (QUOTE_CMD.test(message.content)) {
      const list = quoteInvocations.get(message.channel.id) ?? [];
      list.push({ ts: Date.now(), member });
      if (list.length > 10) list.shift();
      quoteInvocations.set(message.channel.id, list);
    }

    const tier = scan(message.content);
    if (tier) await handleOffence(member, message, tier, 'message');
    return;
  }

  // 2) Socialize Fun bot output: re-scan, attribute to the .quote invoker.
  if (message.author.id !== SOCIALIZE_BOT_ID) return;

  const tier = scan(message.content);
  if (!tier) return;

  const now = Date.now();
  const list = quoteInvocations.get(message.channel.id) ?? [];
  let invoker: GuildMember | null = null;
  while (list.length) {
    const entry = list.pop()!;
    if (now - entry.ts <= QUOTE_WINDOW_MS) {
      invoker = entry.member;
      break;
    }
  }
  quoteInvocations.set(message.channel.id, list);

  await tryDelete(message);
  if (invoker) {
    await log(
      message.guild,
      `**${tier}** content surfaced via \`.quote\` by ${invoker} in ` +
        `${message.channel}; bot repost deleted. Invoker held responsible.`,
    );
    if (!isExempt(invoker)) {
      await handleOffence(invoker, message, tier, 'via .quote invocation');
    }
  } else {
    await log(
      message.guild,
      `**${tier}** content in Socialize bot output in ${message.channel}; ` +
        `deleted, no recent invoker found.`,
    );
  }
});

client.once(Events.ClientReady, () => console.log(`modbot online as ${client.user?.tag}`));

if (!process.env.DISCORD_TOKEN) {
  console.error('Set DISCORD_TOKEN (SOCIALIZE_BOT_ID optional for .quote re-scanning)');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);

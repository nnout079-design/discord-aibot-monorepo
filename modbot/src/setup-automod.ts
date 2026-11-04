/**
 * One-time setup: creates the AutoMod rules for the Visible Vapor server.
 *
 * AutoMod is the front line for member messages (it also acts while the
 * modbot is offline). modbot (index.ts) still handles what AutoMod can't:
 * leetspeak-normalized matching and re-scanning `.quote` output from the
 * Socialize Fun bot.
 *
 * Safe to re-run: rules with the same names are skipped.
 * Bot needs the "Manage Server" permission to create AutoMod rules.
 *
 * Run:  npm run build && npm run setup:automod
 */

import * as dotenv from 'dotenv';
import {
  Client,
  Events,
  GatewayIntentBits,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleEventType,
  AutoModerationActionOptions,
} from 'discord.js';

dotenv.config();

const GUILD_ID = process.env.GUILD_ID ?? '';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID ?? '';

const alert = (): AutoModerationActionOptions => ({
  type: AutoModerationActionType.SendAlertMessage,
  metadata: { channel: LOG_CHANNEL_ID },
});
// Alerts are only added when LOG_CHANNEL_ID is set (non-logging default: off).
const maybeAlert = (): AutoModerationActionOptions[] =>
  LOG_CHANNEL_ID ? [alert()] : [];
const block = (customMessage?: string): AutoModerationActionOptions => ({
  type: AutoModerationActionType.BlockMessage,
  metadata: customMessage ? { customMessage } : {},
});
const timeout = (seconds: number): AutoModerationActionOptions => ({
  type: AutoModerationActionType.Timeout,
  metadata: { durationSeconds: seconds },
});

interface RuleDef {
  name: string;
  triggerType: AutoModerationRuleTriggerType;
  triggerMetadata: Record<string, unknown>;
  actions: AutoModerationActionOptions[];
}

const RULES: RuleDef[] = [
  {
    name: 'Block: minor/sexual references',
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        'jailbait', 'jail bait', 'jail-bait', 'j4ilbait',
        'loli', 'lolicon', 'pedo', 'pedophile', 'pdf file',
      ],
      regexPatterns: ['\\bcp\\b'],
    },
    actions: [block('That content is not allowed here.'), ...maybeAlert(), timeout(3600)],
  },
  {
    name: "Block: slurs & 'gay' as insult",
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      regexPatterns: [
        "\\b(?:ur|u r|you'?re?|you are|ya'?ll|yall)\\b(?:\\s+\\w+){0,4}\\s+(?:gay|fag)\\b",
        "\\b(?:that'?s|thats)\\s+(?:so\\s+|fucking\\s+)?(?:gay|fag)\\b",
        '\\bf+ag{1,2}o?t+\\b',
        '\\br+et+a+rd+e?d?\\b',
      ],
    },
    actions: [block('That language is not allowed here.'), ...maybeAlert()],
  },
  {
    name: 'Block: profanity & bypasses',
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        'fuck', 'fucking', 'fucker', 'fck', 'fuk', 'fonk', 'fucc',
        'phuck', 'fudge', 'shit', 'shitty', 'bitch', 'cunt', 'dick',
        'pussy', 'stfu', 'gtfo', '🖕',
      ],
    },
    actions: [block('Watch the language.'), ...maybeAlert()],
  },
  {
    name: 'Flag: soliciting/begging',
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      regexPatterns: [
        '(?:gimme|give me|send me|buy me|donate(?:\\s+me)?)\\b.{0,40}\\b(?:money|cash|\\$|ticket|nitro|gift|paypal|cash ?app|venmo)',
      ],
    },
    actions: [...maybeAlert()],
  },
  {
    name: 'Flag: mod disrespect',
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        'useless mods', 'useless mod', 'trash mods', 'corrupt mods',
        'shitty mods', 'useless staff', 'useless admins',
      ],
    },
    actions: [...maybeAlert()],
  },
  {
    name: 'Block: commonly flagged words',
    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
    triggerMetadata: {
      presets: [
        AutoModerationRuleKeywordPresetType.Profanity,
        AutoModerationRuleKeywordPresetType.SexualContent,
        AutoModerationRuleKeywordPresetType.Slurs,
      ],
    },
    actions: [block('That content is not allowed here.'), ...maybeAlert()],
  },
  {
    name: 'Block: mention spam',
    triggerType: AutoModerationRuleTriggerType.MentionSpam,
    triggerMetadata: { mentionTotalLimit: 5 },
    actions: [block('Mention spam is not allowed.'), ...maybeAlert(), timeout(600)],
  },
  {
    name: 'Block: suspected spam',
    triggerType: AutoModerationRuleTriggerType.Spam,
    triggerMetadata: {},
    actions: [block('Spam is not allowed.'), ...maybeAlert()],
  },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const existing = await guild.autoModerationRules.fetch();
    const existingNames = new Set(existing.map(r => r.name));

    for (const rule of RULES) {
      if (existingNames.has(rule.name)) {
        console.log(`skip (exists): ${rule.name}`);
        continue;
      }
      await guild.autoModerationRules.create({
        eventType: AutoModerationRuleEventType.MessageSend,
        enabled: true,
        ...rule,
      } as Parameters<typeof guild.autoModerationRules.create>[0]);
      console.log(`created: ${rule.name}`);
    }
    console.log('done');
  } catch (err) {
    console.error('setup failed:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

if (!process.env.DISCORD_TOKEN || !GUILD_ID) {
  console.error('Set DISCORD_TOKEN, GUILD_ID (LOG_CHANNEL_ID optional, enables rule alerts)');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);

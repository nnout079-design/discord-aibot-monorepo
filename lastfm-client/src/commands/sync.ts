import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { createLastFmApi } from "../lastfm/api";
import { PERCUSSION_PATTERNS } from "../midi/world-percussion";
import { companionHub } from "../sync/companion-hub";
import { TrackAttributes } from "../sync/entry";
import { armEntry, getSession, nowPlaying, stopEntry, SyncSession } from "../sync/session";

export const data = new SlashCommandBuilder()
  .setName("sync")
  .setDescription("Timed song entry: count-in, MIDI and cue targets locked to one start timestamp")
  .addSubcommand(command => command
    .setName("start")
    .setDescription("Arm a synced song entry on the next bar line")
    .addStringOption(option => option.setName("username").setDescription("Last.fm username to pull now-playing track attributes from"))
    .addIntegerOption(option => option.setName("lead").setDescription("Seconds until the count-in (default 8)").setMinValue(2).setMaxValue(60))
    .addNumberOption(option => option.setName("bpm").setDescription("Tempo for count-in and pattern (default ~137.5)").setMinValue(40).setMaxValue(240))
    .addIntegerOption(option => option.setName("beats").setDescription("Beats per bar / count-in length (default 4)").setMinValue(2).setMaxValue(12))
    .addStringOption(option => option
      .setName("pattern")
      .setDescription("Percussion pattern to enter on the downbeat")
      .addChoices(...Object.keys(PERCUSSION_PATTERNS).map(name => ({ name, value: name })))))
  .addSubcommand(command => command.setName("stop").setDescription("Cancel the armed song entry or stop the one playing"))
  .addSubcommand(command => command.setName("status").setDescription("Show the armed song entry"));

const unix = (ms: number) => Math.floor(ms / 1000);

function describe(session: SyncSession): EmbedBuilder {
  const { plan, pattern, track } = session;
  const embed = new EmbedBuilder()
    .setTitle(track ? `Song entry: ${track.artist} - ${track.name}` : "Song entry armed")
    .setColor(0x1db954)
    .addFields(
      { name: "Count-in", value: `<t:${unix(plan.countInAt)}:T> (<t:${unix(plan.countInAt)}:R>)`, inline: true },
      { name: "Downbeat", value: `<t:${unix(plan.startAt)}:T> (<t:${unix(plan.startAt)}:R>)`, inline: true },
      { name: "Tempo", value: `${plan.bpm.toFixed(2)} BPM, ${plan.beatsPerBar}/4`, inline: true },
      { name: "Pattern", value: pattern ?? "count-in only", inline: true },
      { name: "Start timestamp", value: `\`${Math.round(plan.startAt)}\` ms`, inline: true },
      { name: "PC companions", value: `${companionHub.connected} connected`, inline: true }
    );
  if (track?.tags.length) embed.addFields({ name: "Tags", value: track.tags.slice(0, 5).join(", "), inline: true });
  return embed;
}

async function handleStart(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  await interaction.deferReply();
  const username = interaction.options.getString("username");
  let track: TrackAttributes | null = null;
  if (username) {
    const api = createLastFmApi();
    if (!api) {
      await interaction.editReply("Last.fm API not configured. Please set LASTFM_API_KEY and LASTFM_API_SECRET.");
      return;
    }
    try {
      track = await nowPlaying(api, username);
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "Could not read now playing from Last.fm.");
      return;
    }
  }

  const session = await armEntry(guildId, {
    bpm: interaction.options.getNumber("bpm") ?? undefined,
    leadMs: (interaction.options.getInteger("lead") ?? 8) * 1000,
    beatsPerBar: interaction.options.getInteger("beats") ?? 4,
    pattern: interaction.options.getString("pattern"),
    track,
    onDownbeat: () => {
      interaction.followUp(`Downbeat: ${track ? `${track.artist} - ${track.name}` : "song entry"} now.`).catch(() => {});
    }
  });
  await interaction.editReply({ embeds: [describe(session)] });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId ?? `dm:${interaction.user.id}`;
  const action = interaction.options.getSubcommand();

  if (action === "start") {
    await handleStart(interaction, guildId);
    return;
  }

  if (action === "stop") {
    const stopped = await stopEntry(guildId);
    await interaction.reply(stopped ? "Song entry cancelled." : "Stopped.");
    return;
  }

  const session = getSession(guildId);
  if (!session) {
    await interaction.reply({ content: "No song entry is armed.", ephemeral: true });
    return;
  }
  await interaction.reply({ embeds: [describe(session)], ephemeral: true });
}

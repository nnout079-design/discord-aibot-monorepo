import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from "discord.js";
import { isCoworker } from "../../security/coworkers";
import { startVoiceTranscription, stopVoiceTranscription } from "../../streaming/voice-transcriber";

export const data = new SlashCommandBuilder()
  .setName("stream")
  .setDescription("Manage the Discord video companion stream")
  .addSubcommand(command => command.setName("start").setDescription("Start companion frame ingestion"))
  .addSubcommand(command => command.setName("stop").setDescription("Stop companion frame ingestion"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isCoworker(interaction.user)) {
    await interaction.reply({ content: "This command is available to approved coworkers only.", ephemeral: true });
    return;
  }

  const action = interaction.options.getSubcommand();
  if (action === "start") {
    const voiceChannel = interaction.guild?.members.cache.get(interaction.user.id)?.voice.channel;
    if (!voiceChannel || !voiceChannel.isVoiceBased() || !interaction.channel?.isTextBased()) {
      await interaction.reply({ content: "Join a voice channel and run this command in a text channel.", ephemeral: true });
      return;
    }
    startVoiceTranscription(voiceChannel, interaction.channel as TextChannel);
    await interaction.reply("Voice transcription started. Companion video clients can POST authenticated frames to `/stream/frame`.");
    return;
  }

  if (interaction.guildId) stopVoiceTranscription(interaction.guildId);
  await interaction.reply("Companion streaming marked stopped. Stop the capture client to end frame uploads.");
}

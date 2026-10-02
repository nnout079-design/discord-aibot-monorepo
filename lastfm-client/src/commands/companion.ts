import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { companionHub } from "../sync/companion-hub";

export const data = new SlashCommandBuilder()
  .setName("companion")
  .setDescription("Show the setup for the PC companion that plays /sync on your MIDI output (private)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const token = companionHub.token;
  if (!token) {
    await interaction.reply({ content: "COMPANION_TOKEN is not set on the bot, so companions can't connect yet.", ephemeral: true });
    return;
  }
  const botUrl = process.env.PUBLIC_URL ?? (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : "http://localhost:8080");
  await interaction.reply({
    ephemeral: true,
    content: [
      `PC companions connected: ${companionHub.connected}`,
      "",
      "Put this in `lastfm-companion/.env` on your PC (keep the token private):",
      "```",
      `BOT_URL=${botUrl}`,
      `COMPANION_TOKEN=${token}`,
      "MIDI_OUTPUT=loopMIDI",
      "```",
      "Then run `npm install` once and `npm start` in `lastfm-companion`. `npm run outputs` lists your MIDI outputs."
    ].join("\n")
  });
}

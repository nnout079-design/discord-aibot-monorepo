import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import {
  DEMO_SCENE,
  formatStealthPlan,
  getLastStealthPlan,
  runStealthCircuit
} from "../../gaming/stealth-circuit";

export const data = new SlashCommandBuilder()
  .setName("stealth")
  .setDescription("Stealth circuit: avoid light, full camouflage")
  .addSubcommand(command => command.setName("plan").setDescription("Show the latest stealth plan for this server"))
  .addSubcommand(command => command.setName("demo").setDescription("Run the example stealth circuit"))
  .addSubcommand(command => command.setName("rules").setDescription("Explain the stealth circuit model"));

const noMentions = { parse: [] as ("roles" | "users" | "everyone")[] };

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getSubcommand();
  if (action === "plan") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Stealth plans are scoped to a server. POST a scene to `/stream/stealth` to create one.",
        ephemeral: true,
        allowedMentions: noMentions
      });
      return;
    }
    const last = getLastStealthPlan(interaction.guildId);
    if (!last) {
      await interaction.reply({
        content: "No stealth plan yet. POST a scene to `/stream/stealth` to create one.",
        ephemeral: true,
        allowedMentions: noMentions
      });
      return;
    }
    await interaction.reply({
      content: `${formatStealthPlan(last.plan)}\nLast updated: ${last.at}`,
      allowedMentions: noMentions
    });
    return;
  }

  if (action === "demo") {
    await interaction.reply({
      content: formatStealthPlan(runStealthCircuit(DEMO_SCENE)),
      allowedMentions: noMentions
    });
    return;
  }

  if (action === "rules") {
    await interaction.reply({
      content: "The stealth circuit estimates light exposure, camouflage fit, cover, movement, and nearby threats. It prefers dark cover with a safer route, recommends full camouflage, and lowers risk by holding still once hidden.",
      ephemeral: true,
      allowedMentions: noMentions
    });
  }
}

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { triggerBatch, triggerMidi } from "../midi/bridge";
import { schedulePattern } from "../midi/schedule";
import { createHit, PercussionHit, PERCUSSION_PATTERNS, WORLD_PERCUSSION } from "../midi/world-percussion";

export const data = new SlashCommandBuilder()
  .setName("percussion")
  .setDescription("Trigger world percussion instruments over MIDI")
  .addSubcommand(command => command.setName("list").setDescription("List available world instruments"))
  .addSubcommand(command => command
    .setName("trigger")
    .setDescription("Trigger one percussion instrument")
    .addStringOption(option => option.setName("instrument").setDescription("Instrument ID").setRequired(true))
    .addIntegerOption(option => option.setName("velocity").setDescription("MIDI velocity 1-127").setMinValue(1).setMaxValue(127)))
  .addSubcommand(command => command
    .setName("pattern")
    .setDescription("Trigger a named world percussion pattern")
    .addStringOption(option => option.setName("name").setDescription("Pattern name").setRequired(true)));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const action = interaction.options.getSubcommand();
  if (action === "list") {
    await interaction.reply({
      content: WORLD_PERCUSSION.map(instrument => `\`${instrument.id}\` ${instrument.name} (${instrument.region}) note ${instrument.midiNote}`).join("\n"),
      ephemeral: true
    });
    return;
  }

  if (action === "trigger") {
    const instrument = interaction.options.getString("instrument", true);
    const hit = createHit(instrument, interaction.options.getInteger("velocity") ?? undefined);
    if (!hit) {
      await interaction.reply({ content: `Unknown instrument. Use /percussion list.`, ephemeral: true });
      return;
    }
    await triggerMidi(hit);
    await interaction.reply(`Triggered ${hit.instrument} on MIDI note ${hit.note}.`);
    return;
  }

  const patternName = interaction.options.getString("name", true).toLowerCase();
  const pattern = PERCUSSION_PATTERNS[patternName];
  if (!pattern) {
    await interaction.reply({ content: `Unknown pattern. Available: ${Object.keys(PERCUSSION_PATTERNS).join(", ")}`, ephemeral: true });
    return;
  }
    const hits = pattern.map(id => createHit(id)).filter((h): h is PercussionHit => h !== undefined);
  const batch = schedulePattern(hits);
  await triggerBatch(batch);
  await interaction.reply(`Triggered ${patternName}: ${pattern.join(" -> ")} at ${batch.bpm.toFixed(2)} BPM.`);
}

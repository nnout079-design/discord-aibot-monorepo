import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
	.setName("airhorn")
	.setDescription("Airhorn bot commands")
	.addSubcommand(command => command
		.setName("play")
		.setDescription("Play an airhorn sound"))
	.addSubcommand(command => command
		.setName("info")
		.setDescription("Get bot information"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const action = interaction.options.getSubcommand();

	switch (action) {
		case "play":
			await handlePlayCommand(interaction);
			break;
		case "info":
			await handleInfoCommand(interaction);
			break;
	}
}

async function handlePlayCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	await interaction.reply("📢 *AIRHORN SOUND* 📢\n*BEW BEW BEW BEW*");
}

async function handleInfoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	const embed = {
		title: "📢 Airhorn Bot",
		description: "A simple audio utility bot for Discord",
		fields: [
			{ name: "Version", value: "1.0.0", inline: true },
			{ name: "Commands", value: "/airhorn play, /airhorn info", inline: true },
			{ name: "Status", value: "🟢 Online", inline: true }
		],
		timestamp: new Date().toISOString()
	};

	await interaction.reply({ embeds: [embed] });
}

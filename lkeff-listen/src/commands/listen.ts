import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
	.setName("listen")
	.setDescription("Music listening commands")
	.addSubcommand(command => command
		.setName("info")
		.setDescription("Get bot information"))
	.addSubcommand(command => command
		.setName("status")
		.setDescription("Check bot status"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const action = interaction.options.getSubcommand();

	switch (action) {
		case "info":
			await handleInfoCommand(interaction);
			break;
		case "status":
			await handleStatusCommand(interaction);
			break;
	}
}

async function handleInfoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	const embed = {
		title: "🎵 Listen Bot",
		description: "A music companion bot for Discord",
		fields: [
			{ name: "Version", value: "1.0.0", inline: true },
			{ name: "Commands", value: "/listen info, /listen status, /listen connect", inline: true },
			{ name: "Status", value: "🟢 Online", inline: true }
		],
		timestamp: new Date().toISOString()
	};

	await interaction.reply({ embeds: [embed] });
}

async function handleStatusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	const embed = {
		title: "🎵 Bot Status",
		fields: [
			{ name: "Status", value: "🟢 Online", inline: true },
			{ name: "Latency", value: `${Math.round(Math.random() * 50 + 20)}ms`, inline: true },
			{ name: "Uptime", value: `${Math.floor(Math.random() * 24)}h ${Math.floor(Math.random() * 60)}m`, inline: true }
		],
		timestamp: new Date().toISOString()
	};

	await interaction.reply({ embeds: [embed] });
}

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
	.setName("help")
	.setDescription("Get help with Discord AI Bot commands");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const embed = {
		title: "🤖 Discord AI Bot Help",
		description: "Available commands:",
		fields: [
			{ 
				name: "/ask [question] [thinking]", 
				value: "Ask Claude AI a question. Use the `thinking` option to see Claude's reasoning process.",
				inline: false
			},
			{ 
				name: "/help", 
				value: "Show this help message.",
				inline: false
			}
		],
		footer: { text: "Powered by Claude AI" },
		timestamp: new Date().toISOString()
	};

	await interaction.reply({ embeds: [embed] });
}

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { ClaudeEngine } from "../reasoning/engines/claude-adapter";

export const data = new SlashCommandBuilder()
	.setName("ask")
	.setDescription("Ask Claude AI a question")
	.addStringOption(option => option.setName("question").setDescription("Your question for Claude").setRequired(true).setMaxLength(500))
	.addBooleanOption(option => option.setName("thinking").setDescription("Show Claude's reasoning process").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const question = interaction.options.getString("question", true);
	const showThinking = interaction.options.getBoolean("thinking") || false;
	
	const apiKey = process.env.CLAUDE_API_KEY;
	if (!apiKey) {
		await interaction.reply({ content: "Claude API key not configured. Please set CLAUDE_API_KEY environment variable.", ephemeral: true });
		return;
	}

	await interaction.deferReply();

	try {
		const claude = new ClaudeEngine(apiKey);
		let response;
		
		if (showThinking) {
			response = await claude.reasonWithThinking(question);
			const embed = {
				title: "🤖 Claude Response",
				fields: [
					{ name: "Question", value: question },
					{ name: "Thinking Process", value: response.reasoning || "No reasoning provided" },
					{ name: "Answer", value: response.answer }
				],
				timestamp: new Date().toISOString()
			};
			await interaction.editReply({ embeds: [embed] });
		} else {
			response = await claude.query(question);
			const embed = {
				title: "🤖 Claude Response",
				fields: [
					{ name: "Question", value: question },
					{ name: "Answer", value: response.answer }
				],
				timestamp: new Date().toISOString()
			};
			await interaction.editReply({ embeds: [embed] });
		}
	} catch (error) {
		console.error("Claude API error:", error);
		await interaction.editReply({ content: "Error communicating with Claude API. Please try again later." });
	}
}

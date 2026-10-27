import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as artifactCommand from './commands/artifact';
import * as askCommand from './commands/ask';
import * as bertcaseCommand from './commands/bertcase';
import * as helpCommand from './commands/help';
import * as progressCommand from './commands/progress';
import * as wellnessCommand from './commands/wellness';
import { recordActivity } from './progress/tracker';
import { startAnalysisServer } from './analysis/server';
dotenv.config();
startAnalysisServer();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [artifactCommand.data, askCommand.data, bertcaseCommand.data, helpCommand.data, progressCommand.data, wellnessCommand.data];
const LOUNGE_GUILD_ID = process.env.LOUNGE_GUILD_ID;
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	if (LOUNGE_GUILD_ID) {
		try {
			await Promise.all(commands.map(command => client.application?.commands.create(command, LOUNGE_GUILD_ID)));
		} catch (error) {
			console.error(`Guild command registration skipped for ${LOUNGE_GUILD_ID}:`, error);
		}
	}
	console.log('✓ Registered /artifact');
	console.log('✓ Registered /ask');
	console.log('✓ Registered /bertcase');
	console.log('✓ Registered /help');
	console.log('✓ Registered /progress');
	console.log('✓ Registered /wellness');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === artifactCommand.data.name) {
		await artifactCommand.execute(interaction);
	}
	if (interaction.commandName === askCommand.data.name) {
		await askCommand.execute(interaction);
	}
	if (interaction.commandName === bertcaseCommand.data.name) {
		await bertcaseCommand.execute(interaction);
	}
	if (interaction.commandName === helpCommand.data.name) {
		await helpCommand.execute(interaction);
	}
	if (interaction.commandName === progressCommand.data.name) {
		await progressCommand.execute(interaction);
	}
	if (interaction.commandName === wellnessCommand.data.name) {
		await wellnessCommand.execute(interaction);
	}
	const subcommand = interaction.options.getSubcommand(false) ?? '';
	recordActivity(interaction.guildId ?? 'dm', interaction.user.id, interaction.commandName, subcommand);
});
client.login(process.env.DISCORD_TOKEN);

import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as airhornCommand from './commands/airhorn';
import * as bertcaseCommand from './commands/bertcase';
import * as progressCommand from './commands/progress';
import * as wellnessCommand from './commands/wellness';
import { recordActivity } from './progress/tracker';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [airhornCommand.data, bertcaseCommand.data, progressCommand.data, wellnessCommand.data];
const LOUNGE_GUILD_ID = '505974446914535426';
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	await Promise.all(commands.map(command => client.application?.commands.create(command, LOUNGE_GUILD_ID)));
	console.log('✓ Registered /airhorn');
	console.log('✓ Registered /bertcase');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === airhornCommand.data.name) {
		await airhornCommand.execute(interaction);
	}
	if (interaction.commandName === bertcaseCommand.data.name) {
		await bertcaseCommand.execute(interaction);
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

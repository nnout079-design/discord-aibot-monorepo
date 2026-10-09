import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as listenCommand from './commands/listen';
import * as bertcaseCommand from './commands/bertcase';
import * as wellnessCommand from './commands/wellness';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const commands = [listenCommand.data, bertcaseCommand.data, wellnessCommand.data];
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	console.log('✓ Registered /listen');
	console.log('✓ Registered /bertcase');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === listenCommand.data.name) {
		await listenCommand.execute(interaction);
	}
	if (interaction.commandName === bertcaseCommand.data.name) {
		await bertcaseCommand.execute(interaction);
	}
	if (interaction.commandName === wellnessCommand.data.name) {
		await wellnessCommand.execute(interaction);
	}
});
client.login(process.env.DISCORD_TOKEN);

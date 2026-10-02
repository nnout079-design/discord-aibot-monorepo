import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as listenCommand from './commands/listen';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const commands = [listenCommand.data];
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	console.log('✓ Registered /listen');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === listenCommand.data.name) {
		await listenCommand.execute(interaction);
	}
});
client.login(process.env.DISCORD_TOKEN);

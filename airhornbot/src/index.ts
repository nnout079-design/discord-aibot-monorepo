import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as airhornCommand from './commands/airhorn';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [airhornCommand.data];
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await client.application?.commands.set(commands);
	console.log('✓ Registered /airhorn');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === airhornCommand.data.name) {
		await airhornCommand.execute(interaction);
	}
});
client.login(process.env.DISCORD_TOKEN);

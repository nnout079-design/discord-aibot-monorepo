import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as askCommand from './commands/ask';
import * as helpCommand from './commands/help';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [askCommand.data, helpCommand.data];
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	console.log('✓ Registered /ask');
	console.log('✓ Registered /help');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === askCommand.data.name) {
		await askCommand.execute(interaction);
	}
	if (interaction.commandName === helpCommand.data.name) {
		await helpCommand.execute(interaction);
	}
});
client.login(process.env.DISCORD_TOKEN);

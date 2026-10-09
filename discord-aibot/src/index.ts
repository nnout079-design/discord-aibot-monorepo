import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as askCommand from './commands/ask';
import * as bertcaseCommand from './commands/bertcase';
import * as helpCommand from './commands/help';
import * as wellnessCommand from './commands/wellness';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [askCommand.data, bertcaseCommand.data, helpCommand.data, wellnessCommand.data];
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	console.log('✓ Registered /ask');
	console.log('✓ Registered /bertcase');
	console.log('✓ Registered /help');
	console.log('✓ Registered /wellness');
});
client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	
	if (interaction.commandName === askCommand.data.name) {
		await askCommand.execute(interaction);
	}
	if (interaction.commandName === bertcaseCommand.data.name) {
		await bertcaseCommand.execute(interaction);
	}
	if (interaction.commandName === helpCommand.data.name) {
		await helpCommand.execute(interaction);
	}
	if (interaction.commandName === wellnessCommand.data.name) {
		await wellnessCommand.execute(interaction);
	}
});
client.login(process.env.DISCORD_TOKEN);

import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as askCommand from './commands/reasoning/ask';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
	console.log('✓ Bot ready');
	await client.application?.commands.set([askCommand.data]);
	console.log('✓ Registered /ask');
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand() || interaction.commandName !== askCommand.data.name) {
		return;
	}

	await askCommand.execute(interaction);
});

client.login(process.env.DISCORD_TOKEN);


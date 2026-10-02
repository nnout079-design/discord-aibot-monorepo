import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as askCommand from './commands/reasoning/ask';
import * as streamCommand from './commands/streaming/stream';
import * as gameCommand from './commands/gaming/game';
import { attachGameReactionClient, startCompanionServer } from './streaming/companion-server';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const commands = [askCommand.data, streamCommand.data, gameCommand.data];
attachGameReactionClient(client);
startCompanionServer();

client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	console.log('✓ Registered /reason');
	console.log('✓ Registered /stream and /game');
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) {
		return;
	}

	if (interaction.commandName === askCommand.data.name) await askCommand.execute(interaction);
	if (interaction.commandName === streamCommand.data.name) await streamCommand.execute(interaction);
	if (interaction.commandName === gameCommand.data.name) await gameCommand.execute(interaction);
});

const discordToken = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN;
if (!discordToken) {
	throw new Error('DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable not set');
}

client.login(discordToken);


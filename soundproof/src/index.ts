import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as askCommand from './commands/reasoning/ask';
import * as bertcaseCommand from './commands/bertcase';
import * as streamCommand from './commands/streaming/stream';
import * as gameCommand from './commands/gaming/game';
import * as handballCommand from './commands/gaming/handball';
import * as stealthCommand from './commands/gaming/stealth';
import * as progressCommand from './commands/progress';
import * as wellnessCommand from './commands/wellness';
import { recordActivity } from './progress/tracker';
import { attachGameReactionClient, startCompanionServer } from './streaming/companion-server';
import { attachVehicleCallbackClient } from './streaming/vehicle-callback';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const commands = [askCommand.data, bertcaseCommand.data, streamCommand.data, gameCommand.data, handballCommand.data, stealthCommand.data, progressCommand.data, wellnessCommand.data];
attachGameReactionClient(client);
attachVehicleCallbackClient(client);
startCompanionServer();

const LOUNGE_GUILD_ID = '505974446914535426';
client.once('ready', async () => {
	console.log('✓ Bot ready');
	await Promise.all(commands.map(command => client.application?.commands.create(command)));
	await Promise.all(commands.map(command => client.application?.commands.create(command, LOUNGE_GUILD_ID)));
	console.log('✓ Registered /reason');
	console.log('✓ Registered /bertcase');
	console.log('✓ Registered /stream and /game');
	console.log('✓ Registered /handball');
	console.log('✓ Registered /stealth');
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) {
		return;
	}

	if (interaction.commandName === askCommand.data.name) await askCommand.execute(interaction);
	if (interaction.commandName === bertcaseCommand.data.name) await bertcaseCommand.execute(interaction);
	if (interaction.commandName === streamCommand.data.name) await streamCommand.execute(interaction);
	if (interaction.commandName === gameCommand.data.name) await gameCommand.execute(interaction);
	if (interaction.commandName === handballCommand.data.name) await handballCommand.execute(interaction);
	if (interaction.commandName === progressCommand.data.name) await progressCommand.execute(interaction);
	if (interaction.commandName === stealthCommand.data.name) await stealthCommand.execute(interaction);
	if (interaction.commandName === wellnessCommand.data.name) await wellnessCommand.execute(interaction);
	const subcommand = interaction.options.getSubcommand(false) ?? '';
	recordActivity(interaction.guildId ?? 'dm', interaction.user.id, interaction.commandName, subcommand);
});

const discordToken = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN;
if (!discordToken) {
	throw new Error('DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable not set');
}

client.login(discordToken);

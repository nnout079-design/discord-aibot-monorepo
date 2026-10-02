import * as dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import * as percussionCommand from './commands/percussion';
import * as lastfmCommand from './commands/lastfm';
import * as syncCommand from './commands/sync';
import * as companionCommand from './commands/companion';
import { companionHub } from './sync/companion-hub';
import { companionControl } from './sync/session';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = [percussionCommand.data, lastfmCommand.data, syncCommand.data, companionCommand.data];
client.once('ready', async () => {
  console.log('✓ Bot ready');
  try {
    await Promise.all(commands.map(command => client.application?.commands.create(command)));
    console.log('✓ Registered /percussion');
    console.log('✓ Registered /lastfm');
    console.log('✓ Registered /sync');
    console.log('✓ Registered /companion');
  } catch (error) {
    console.error('Command registration failed:', error);
  }
});
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === percussionCommand.data.name) {
      await percussionCommand.execute(interaction);
    }
    if (interaction.commandName === lastfmCommand.data.name) {
      await lastfmCommand.execute(interaction);
    }
    if (interaction.commandName === syncCommand.data.name) {
      await syncCommand.execute(interaction);
    }
    if (interaction.commandName === companionCommand.data.name) {
      await companionCommand.execute(interaction);
    }
  } catch (error) {
    console.error('Command failed:', error);
    const msg = { content: 'Command failed.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});
companionHub.setControl(companionControl);
companionHub.listen(Number(process.env.PORT ?? 8080))
  .then(port => console.log(`✓ Companion hub listening on ${port}`))
  .catch(error => console.error('Companion hub failed:', error));
client.login(process.env.DISCORD_TOKEN);
import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('ready', () => console.log('✓ Bot ready'));
client.login(process.env.DISCORD_TOKEN);

import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { createLastFmApi, LastFmRecentTrack, LastFmTrack, LastFmUser } from "../lastfm/api";

export const data = new SlashCommandBuilder()
	.setName("lastfm")
	.setDescription("Last.fm music tracking commands")
	.addSubcommand(command => command
		.setName("user")
		.setDescription("Get Last.fm user information")
		.addStringOption(option => option.setName("username").setDescription("Last.fm username").setRequired(true)))
	.addSubcommand(command => command
		.setName("recent")
		.setDescription("Get recent tracks for a user")
		.addStringOption(option => option.setName("username").setDescription("Last.fm username").setRequired(true))
		.addIntegerOption(option => option.setName("limit").setDescription("Number of tracks (1-50)").setMinValue(1).setMaxValue(50)))
	.addSubcommand(command => command
		.setName("top")
		.setDescription("Get top tracks for a user")
		.addStringOption(option => option.setName("username").setDescription("Last.fm username").setRequired(true))
		.addIntegerOption(option => option.setName("limit").setDescription("Number of tracks (1-50)").setMinValue(1).setMaxValue(50)))
	.addSubcommand(command => command
		.setName("track")
		.setDescription("Get track information")
		.addStringOption(option => option.setName("track").setDescription("Track name").setRequired(true))
		.addStringOption(option => option.setName("artist").setDescription("Artist name").setRequired(true)));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	const api = createLastFmApi();
	if (!api) {
		await interaction.reply({ content: "Last.fm API not configured. Please set LASTFM_API_KEY and LASTFM_API_SECRET.", ephemeral: true });
		return;
	}

	const action = interaction.options.getSubcommand();

	try {
		switch (action) {
			case "user":
				await handleUserCommand(interaction, api);
				break;
			case "recent":
				await handleRecentCommand(interaction, api);
				break;
			case "top":
				await handleTopCommand(interaction, api);
				break;
			case "track":
				await handleTrackCommand(interaction, api);
				break;
		}
	} catch (error) {
		console.error("Last.fm command error:", error);
		await interaction.reply({ content: "Error executing Last.fm command. Please try again.", ephemeral: true });
	}
}

async function handleUserCommand(interaction: ChatInputCommandInteraction, api: any): Promise<void> {
	const username = interaction.options.getString("username", true);
	await interaction.deferReply();

	const userInfo: LastFmUser = await api.getUserInfo(username);

	const embed = {
		title: `🎵 ${userInfo.name}`,
		url: userInfo.url,
		fields: [
			{ name: "Play Count", value: userInfo.playcount.toLocaleString(), inline: true },
			{ name: "Country", value: userInfo.country || "Unknown", inline: true },
			{ name: "Age", value: userInfo.age?.toString() || "Unknown", inline: true }
		],
		thumbnail: { url: userInfo.image?.[2] || "" },
		        timestamp: new Date(Number(userInfo.registered?.unixtime) * 1000 || Date.now()).toISOString()
	};

	await interaction.editReply({ embeds: [embed] });
}

async function handleRecentCommand(interaction: ChatInputCommandInteraction, api: any): Promise<void> {
	const username = interaction.options.getString("username", true);
	const limit = interaction.options.getInteger("limit") || 10;
	await interaction.deferReply();

	const recentTracks: LastFmRecentTrack[] = await api.getRecentTracks(username, limit);

	if (recentTracks.length === 0) {
		await interaction.editReply({ content: `No recent tracks found for ${username}` });
		return;
	}

	const nowPlaying = recentTracks[0]['@attr']?.nowplaying === 'true';
	const tracks = recentTracks.slice(0, 10).map((track, index) => {
		const isNowPlaying = index === 0 && nowPlaying;
		const emoji = isNowPlaying ? "🎶" : "▫️";
		const album = track.album?.['#text'] || "Unknown Album";
		return `${emoji} **${track.name}** by ${track.artist['#text']} (${album})`;
	}).join("\n");

	const embed = {
		title: `🎵 Recent Tracks - ${username}`,
		description: tracks,
		footer: { text: nowPlaying ? "Currently playing" : `Last ${Math.min(limit, 10)} tracks` }
	};

	await interaction.editReply({ embeds: [embed] });
}

async function handleTopCommand(interaction: ChatInputCommandInteraction, api: any): Promise<void> {
	const username = interaction.options.getString("username", true);
	const limit = interaction.options.getInteger("limit") || 10;
	await interaction.deferReply();

	const topTracks: LastFmTrack[] = await api.getTopTracks(username, limit);

	if (topTracks.length === 0) {
		await interaction.editReply({ content: `No top tracks found for ${username}` });
		return;
	}

	const tracks = topTracks.slice(0, 10).map((track, index) => {
		return `${index + 1}. **${track.name}** by ${track.artist} (${track.playcount?.toLocaleString() || 0} plays)`;
	}).join("\n");

	const embed = {
		title: `🏆 Top Tracks - ${username}`,
		description: tracks
	};

	await interaction.editReply({ embeds: [embed] });
}

async function handleTrackCommand(interaction: ChatInputCommandInteraction, api: any): Promise<void> {
	const track = interaction.options.getString("track", true);
	const artist = interaction.options.getString("artist", true);
	await interaction.deferReply();

	const trackInfo: LastFmTrack = await api.getTrackInfo(track, artist);

	const embed = {
		title: `🎵 ${trackInfo.name}`,
		url: trackInfo.url,
		fields: [
			{ name: "Artist", value: trackInfo.artist, inline: true },
			{ name: "Album", value: trackInfo.album || "Unknown", inline: true },
			{ name: "Play Count", value: trackInfo.playcount?.toLocaleString() || "0", inline: true },
			{ name: "Listeners", value: trackInfo.listeners?.toLocaleString() || "0", inline: true }
		],
		thumbnail: { url: trackInfo.image?.[2] || "" }
	};

	await interaction.editReply({ embeds: [embed] });
}

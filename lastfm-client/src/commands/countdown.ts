import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { SongDetector } from '../services/song-detector';
import { SyncManager } from '../services/sync-manager';
import { LastFmApi } from '../lastfm/api';

// Global instances for sync management
const syncManagers = new Map<string, SyncManager>();
const songDetectors = new Map<string, SongDetector>();

export const data = new SlashCommandBuilder()
  .setName('countdown')
  .setDescription('Manage countdown timer for song synchronization')
  .addSubcommand(subcommand =>
    subcommand
      .setName('start')
      .setDescription('Start countdown for current Last.fm song')
      .addStringOption(option =>
        option
          .setName('username')
          .setDescription('Last.fm username')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stop')
      .setDescription('Stop the countdown timer')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Show current countdown status')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('config')
      .setDescription('Configure countdown settings')
      .addIntegerOption(option =>
        option
          .setName('duration')
          .setDescription('Countdown duration in seconds (default: 10)')
          .setMinValue(3)
          .setMaxValue(60)
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('pattern')
          .setDescription('MIDI pattern to trigger (intro, build, drop)')
          .setRequired(false)
          .addChoices(
            { name: 'Intro', value: 'intro' },
            { name: 'Build', value: 'build' },
            { name: 'Drop', value: 'drop' },
          )
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('midi')
      .setDescription('MIDI sequencer controls')
      .addStringOption(option =>
        option
          .setName('action')
          .setDescription('MIDI action')
          .setRequired(true)
          .addChoices(
            { name: 'Play', value: 'play' },
            { name: 'Stop', value: 'stop' },
            { name: 'Trigger Note', value: 'trigger' },
          )
      )
      .addIntegerOption(option =>
        option
          .setName('note')
          .setDescription('MIDI note number (0-127)')
          .setMinValue(0)
          .setMaxValue(127)
          .setRequired(false)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId || 'dm';

  switch (subcommand) {
    case 'start':
      await handleStart(interaction, guildId);
      break;
    case 'stop':
      await handleStop(interaction, guildId);
      break;
    case 'status':
      await handleStatus(interaction, guildId);
      break;
    case 'config':
      await handleConfig(interaction, guildId);
      break;
    case 'midi':
      await handleMIDI(interaction, guildId);
      break;
  }
}

async function handleStart(interaction: ChatInputCommandInteraction, guildId: string) {
  await interaction.deferReply();

  const username = interaction.options.getString('username', true);
  const lastfm = new LastFmApi(
    process.env.LASTFM_API_KEY || '',
    process.env.LASTFM_API_SECRET || ''
  );

  try {
    // Create sync manager
    const syncManager = new SyncManager();
    syncManagers.set(guildId, syncManager);

    // Create song detector
    const detector = new SongDetector(lastfm, username);
    songDetectors.set(guildId, detector);

    // Detect current song
    const result = await detector.detectSong();
    
    if (!result.hasSong || !result.song) {
      await interaction.editReply({
        content: `❌ No song currently playing for Last.fm user: ${username}\nMake sure you're playing music on Last.fm.`,
      });
      return;
    }

    // Initialize sync manager
    syncManager.initialize();

    // Start sync
    const startTime = Date.now() + 10000; // 10 seconds from now
    syncManager.startSync(startTime, result.song);

    // Start polling for song changes
    detector.setCallbacks({
      onNewSong: (song, songStartTime) => {
        const existingSync = syncManagers.get(guildId);
        if (existingSync) {
          existingSync.startSync(songStartTime, song);
        }
      },
      onError: (error) => {
        console.error('Song detector error:', error);
      },
    });
    detector.startPolling(5000);

    // Create embed
    const status = syncManager.getStatus();
    const embed = new EmbedBuilder()
      .setTitle('🎵 Sync Started')
      .setColor('#00ff00')
      .setDescription(`Syncing to: **${result.song.name}** by **${result.song.artist}**`)
      .addFields(
        { name: 'Album', value: result.song.album, inline: true },
        { name: 'Countdown', value: '10 seconds', inline: true },
        { name: 'Pattern', value: status.pattern, inline: true },
      )
      .setTimestamp();

    if (result.song.imageUrl) {
      embed.setThumbnail(result.song.imageUrl);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Sync start error:', error);
    await interaction.editReply({
      content: `❌ Error starting sync: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStop(interaction: ChatInputCommandInteraction, guildId: string) {
  const syncManager = syncManagers.get(guildId);
  const detector = songDetectors.get(guildId);

  if (!syncManager || !detector) {
    await interaction.reply({
      content: '❌ No sync is currently running.',
      ephemeral: true,
    });
    return;
  }

  syncManager.stopSync();
  detector.stopPolling();
  syncManagers.delete(guildId);
  songDetectors.delete(guildId);

  await interaction.reply({
    content: '✅ Sync stopped successfully.',
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction, guildId: string) {
  const syncManager = syncManagers.get(guildId);
  const detector = songDetectors.get(guildId);

  if (!syncManager || !detector) {
    await interaction.reply({
      content: '❌ No sync is currently running.',
      ephemeral: true,
    });
    return;
  }

  const status = syncManager.getStatus();
  const lastSong = detector.getLastSong();

  const embed = new EmbedBuilder()
    .setTitle('⏱️ Sync Status')
    .setColor('#00aaff')
    .addFields(
      { name: 'Countdown', value: status.countdown ? 'Running' : 'Stopped', inline: true },
      { name: 'Sequencer', value: status.sequencer ? 'Running' : 'Stopped', inline: true },
      { name: 'Pattern', value: status.pattern, inline: true },
      { name: 'Tempo', value: `${status.tempo} BPM`, inline: true },
    );

  if (lastSong) {
    embed.addFields(
      { name: 'Current Song', value: lastSong.name, inline: true },
      { name: 'Artist', value: lastSong.artist, inline: true },
    );
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleConfig(interaction: ChatInputCommandInteraction, guildId: string) {
  const duration = interaction.options.getInteger('duration');
  const pattern = interaction.options.getString('pattern');
  const syncManager = syncManagers.get(guildId);

  if (!syncManager) {
    await interaction.reply({
      content: '⚠️ No sync running. Configuration will apply to the next sync.',
      ephemeral: true,
    });
    return;
  }

  const config: any = {};
  if (duration !== null) {
    config.countdownDuration = duration;
  }
  if (pattern) {
    config.patternName = pattern;
  }

  syncManager.updateConfig(config);

  const changes = [];
  if (duration) changes.push(`duration: ${duration}s`);
  if (pattern) changes.push(`pattern: ${pattern}`);

  await interaction.reply({
    content: `✅ Configuration updated: ${changes.join(', ')}.`,
  });
}

async function handleMIDI(interaction: ChatInputCommandInteraction, guildId: string) {
  const action = interaction.options.getString('action', true);
  const syncManager = syncManagers.get(guildId);

  if (!syncManager) {
    await interaction.reply({
      content: '❌ No sync manager initialized. Start sync first with /countdown start.',
      ephemeral: true,
    });
    return;
  }

  switch (action) {
    case 'play':
      syncManager.setPattern(syncManager.getConfig().patternName);
      await interaction.reply({
        content: '✅ MIDI sequencer started.',
      });
      break;

    case 'stop':
      syncManager.stopSync();
      await interaction.reply({
        content: '✅ MIDI sequencer stopped.',
      });
      break;

    case 'trigger':
      const note = interaction.options.getInteger('note');
      if (note === null) {
        await interaction.reply({
          content: '❌ Note number required for trigger action.',
          ephemeral: true,
        });
        return;
      }
      syncManager.triggerManualNote(note);
      await interaction.reply({
        content: `✅ Triggered MIDI note: ${note}`,
      });
      break;
  }
}

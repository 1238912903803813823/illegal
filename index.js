const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');

// --- Load .env manually ---
try {
  const envFile = fs.readFileSync('.env', 'utf-8');
  const tokenLine = envFile.split('\n').find(l => l.startsWith('DISCORD_TOKEN='));
  if (tokenLine) process.env.DISCORD_TOKEN = tokenLine.split('=')[1].trim();
} catch (e) {
  console.error('Could not read .env file:', e.message);
}

// --- Auth config ---
// Set these in your .env file
// DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, OAUTH_REDIRECT_URI, AUTH_SERVER_URL, PULL_SECRET
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:3000';
const PULL_SECRET = process.env.PULL_SECRET || 'illegal-rest-s3cr3t-k3y-change-this-xK9mP2qL8vN4wR7';
const OAUTH_URL = process.env.AUTH_SERVER_URL ? process.env.AUTH_SERVER_URL + '/auth' : 'http://localhost:3000/auth';

// --- BOT OWNER ID (only this user can use ,pull) ---
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';



// --- Config ---
const CONFIG_FILE = (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER) ? '/tmp/config.json' : './config.json';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ prefixes: {}, managers: {} }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  if (!data.managers) data.managers = {};
  return data;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getPrefix(guildId) {
  return loadConfig().prefixes[guildId] || ',';
}

function setPrefix(guildId, prefix) {
  const config = loadConfig();
  config.prefixes[guildId] = prefix;
  saveConfig(config);
}

function getManagers(guildId) {
  return loadConfig().managers[guildId] || [];
}

function addManager(guildId, userId) {
  const config = loadConfig();
  if (!config.managers[guildId]) config.managers[guildId] = [];
  if (!config.managers[guildId].includes(userId)) config.managers[guildId].push(userId);
  saveConfig(config);
}

function removeManager(guildId, userId) {
  const config = loadConfig();
  if (!config.managers[guildId]) return;
  config.managers[guildId] = config.managers[guildId].filter(id => id !== userId);
  saveConfig(config);
}

function isManager(message) {
  if (message.guild.ownerId === message.author.id) return true;
  return getManagers(message.guild.id).includes(message.author.id);
}

function isBotOwner(message) {
  return BOT_OWNER_ID && message.author.id === BOT_OWNER_ID;
}

// --- Protected users --- stored in auth server DB ---
async function getProtectedList() {
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/protected', {
      headers: { 'x-pull-secret': PULL_SECRET },
    });
    const data = await res.json();
    return data.protected || [];
  } catch (e) { return []; }
}

async function setProtectedList(list) {
  try {
    await fetch(AUTH_SERVER_URL + '/api/protected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pull-secret': PULL_SECRET },
      body: JSON.stringify({ protected: list }),
    });
  } catch (e) {}
}

async function isProtectedUser(userId) {
  const list = await getProtectedList();
  return list.includes(userId);
}

// --- Ghost ping cache ---
const ghostPingCache = new Map();
const GHOST_CACHE_MAX = 500;

// --- Rate limiting ---
const cooldowns = new Map();
const COOLDOWN_MS = 45000;

// --- Pending DM sessions ---
// userId -> { step, type, target, guildId, channelId, confirmMsg }
const dmSessions = new Map();

// --- Pending nuke confirms ---
// userId -> { channelId, guildId, confirmMsgId }
const nukeSessions = new Map();

// --- Constants ---
const VALID_PREFIXES = [',', '.', '!', '?'];
const FOOTER = 'https://lured.rest';
const EMBED_COLOR = 0x23272a;
const AUTO_DELETE_MS = 60000;

// --- Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL'],
});

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName('findping')
    .setDescription('Find the newest personal ping or ghost ping for you in this channel.')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Search pings for this user instead of yourself')
        .setRequired(false)
    )
    .toJSON(),
];

client.once('clientReady', async () => {
  console.log('Logged in as ' + client.user.tag);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered globally.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }

  // --- Rotating status ---
  const statuses = [
    'bot made by @illegalization',
    'bot is still under development',
    'do ",cmds" to view all current cmds.',
  ];
  let statusIdx = 0;
  const setStatus = () => {
    client.user.setPresence({
      status: 'dnd',
      activities: [{ name: statuses[statusIdx], type: 4 }],
    });
    statusIdx = (statusIdx + 1) % statuses.length;
  };
  setStatus();
  setInterval(setStatus, 5000);
});

// --- Track deleted messages for ghost pings ---
client.on('messageDelete', (message) => {
  if (!message.guild) return;
  if (message.author && message.author.bot) return;
  if (!message.mentions || message.mentions.users.size === 0) return;
  if (message.mentions.everyone) return;
  const mentionedIds = [...message.mentions.users.keys()];
  if (mentionedIds.length === 0) return;
  const channelId = message.channel.id;
  if (!ghostPingCache.has(channelId)) ghostPingCache.set(channelId, []);
  const cache = ghostPingCache.get(channelId);
  cache.unshift({
    authorId: message.author ? message.author.id : 'unknown',
    authorTag: message.author ? message.author.username : 'Unknown',
    mentionedIds,
    content: message.content || '',
    timestamp: message.createdTimestamp,
  });
  if (cache.length > GHOST_CACHE_MAX) cache.length = GHOST_CACHE_MAX;
});

// --- Slash: /findping ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'findping') {
    const target = interaction.options.getUser('user') || interaction.user;
    await handleFindPing(interaction, target, true);
  }
});

// --- Parse message URL ---
function parseMessageUrl(url) {
  const match = url.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

// --- Dedup guard to prevent double execution ---
const processingMessages = new Set();

// --- Prefix message handler ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (processingMessages.has(message.id)) return;
  processingMessages.add(message.id);
  setTimeout(() => processingMessages.delete(message.id), 5000);

  const prefix = getPrefix(message.guild.id);
  const content = message.content.trim();

  // --- Handle active DM sessions (reply flow) ---
  if (dmSessions.has(message.author.id)) {
    const session = dmSessions.get(message.author.id);
    if (message.guild.id !== session.guildId) return; // wrong server

    if (session.step === 'awaiting_content') {
      // They replied with a message URL or plain content
      dmSessions.delete(message.author.id);
      await handleDmContent(message, session, content);
      return;
    }

    if (session.step === 'awaiting_confirm') {
      const bare = content.toLowerCase().replace(/^[,\.!\?]/, '').trim();
      if (bare === 'confirm') {
        dmSessions.delete(message.author.id);
        await executeDmSend(message, session);
      } else {
        dmSessions.delete(message.author.id);
        await message.reply('Cancelled. No messages were sent.');
      }
      return;
    }
  }

  // --- Handle nuke confirm (before prefix check so plain "confirm" works) ---
  if (nukeSessions.has(message.author.id)) {
    const session = nukeSessions.get(message.author.id);
    if (message.guild.id === session.guildId && message.channel.id === session.confirmChannelId) {
      nukeSessions.delete(message.author.id);
      const bare = content.toLowerCase().replace(/^[,\.!\?]/, '').trim();
      if (bare !== 'confirm') {
        return message.reply('Nuke cancelled.');
      }
      const targetChannel = message.guild.channels.cache.get(session.channelId);
      if (!targetChannel) return message.reply('Channel no longer exists.');
      try {
        const name = targetChannel.name;
        const topic = targetChannel.topic || undefined;
        const nsfw = targetChannel.nsfw;
        const rateLimitPerUser = targetChannel.rateLimitPerUser;
        const parent = targetChannel.parentId || null;
        const position = targetChannel.position;
        const permissionOverwrites = [...targetChannel.permissionOverwrites.cache.values()].map(o => ({
          id: o.id,
          type: o.type,
          allow: o.allow,
          deny: o.deny,
        }));
        await targetChannel.delete('Nuked by ' + message.author.tag);
        const newChannel = await message.guild.channels.create({
          name,
          type: targetChannel.type,
          topic,
          nsfw,
          rateLimitPerUser,
          parent,
          position,
          permissionOverwrites,
          reason: 'Nuked by ' + message.author.tag,
        });
        await newChannel.send('first');
      } catch (e) {
        console.error('[Nuke error]', e);
        message.reply('Failed to nuke the channel: ' + e.message).catch(() => {});
      }
      return;
    }
  }

  // Strict: only respond to the current server prefix
  if (!content.startsWith(prefix)) return;

  const rawCmd = content.slice(prefix.length).trim();
  // Only respond if the message starts with prefix immediately followed by cmd (no other text before)
  if (content !== prefix + rawCmd) return;
  const args = rawCmd.split(/\s+/);
  const cmd = args[0] ? args[0].toLowerCase() : '';
  // Support "dm all" with space
  const fullCmd = args.slice(0, 2).join(' ').toLowerCase();

  // prefix cmd
  if (cmd === 'prefix') {
    const newPrefix = args[1];
    if (!newPrefix) {
      return message.reply('Current prefix: `' + prefix + '`\nAvailable: ' + VALID_PREFIXES.map(p => '`' + p + '`').join(', '));
    }
    if (!VALID_PREFIXES.includes(newPrefix)) {
      return message.reply('Invalid prefix. Choose one of: ' + VALID_PREFIXES.map(p => '`' + p + '`').join(', '));
    }
    setPrefix(message.guild.id, newPrefix);
    return message.reply('prefix changed to `' + newPrefix + '`.');
  }

  // manager cmd - bot owner only
  if (cmd === 'manager') {
    if (!isBotOwner(message)) {
      return message.reply('Only the bot owner can manage bot managers.');
    }
    const sub = args[1] ? args[1].toLowerCase() : '';
    const mentioned = message.mentions.users.first();

    if (sub === 'add') {
      if (!mentioned) return message.reply('Mention a user to add as manager. Ex: `' + prefix + 'manager add @user`');
      addManager(message.guild.id, mentioned.id);
      return message.reply('Added **' + mentioned.username + '** as a bot manager.');
    }
    if (sub === 'remove') {
      if (!mentioned) return message.reply('Mention a user to remove. Ex: `' + prefix + 'manager remove @user`');
      const managers = getManagers(message.guild.id);
      if (!managers.includes(mentioned.id)) return message.reply('**' + mentioned.username + '** is not a manager.');
      removeManager(message.guild.id, mentioned.id);
      return message.reply('Removed **' + mentioned.username + '** from bot managers.');
    }
    if (sub === 'list') {
      const managers = getManagers(message.guild.id);
      if (managers.length === 0) return message.reply('no managers set.');
      const lines = [];
      for (const id of managers) {
        let username = 'Unknown';
        try {
          const user = client.users.cache.get(id) || await Promise.race([
            client.users.fetch(id),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
          ]).catch(() => null);
          if (user) username = user.username;
        } catch (e) {}
        lines.push(id + ' - ' + username);
      }
      return message.reply(lines.join('\n'));
    }
    return message.reply(
      'Manager commands:\n' +
      '`' + prefix + 'manager add @user` — Add a manager\n' +
      '`' + prefix + 'manager remove @user` — Remove a manager\n' +
      '`' + prefix + 'manager list` — List all managers'
    );
  }

  // dm all / dm @user - managers only
  if (fullCmd === 'dm all' || (cmd === 'dm' && args[1] && args[1].toLowerCase() === 'all')) {
    if (!isManager(message)) return message.reply('You need to be a bot manager to use this command.');
    const memberCount = message.guild.memberCount;
    const prompt = await message.reply('send a message link or message content to send to all **' + memberCount + '** members.');
    dmSessions.set(message.author.id, {
      step: 'awaiting_content',
      type: 'all',
      guildId: message.guild.id,
      channelId: message.channel.id,
      promptMsg: prompt,
    });
    // Expire session after 5 min
    setTimeout(() => {
      if (dmSessions.has(message.author.id)) {
        dmSessions.delete(message.author.id);
        prompt.edit('Session expired. Run the command again.').catch(() => {});
      }
    }, 300000);
    return;
  }

  if (cmd === 'dm' && message.mentions.users.size > 0) {
    if (!isManager(message)) return message.reply('You need to be a bot manager to use this command.');
    const target = message.mentions.users.first();
    const prompt = await message.reply('send a message link or message content to send to **' + target.username + '**.');
    dmSessions.set(message.author.id, {
      step: 'awaiting_content',
      type: 'user',
      targetId: target.id,
      targetName: target.username,
      guildId: message.guild.id,
      channelId: message.channel.id,
      promptMsg: prompt,
    });
    setTimeout(() => {
      if (dmSessions.has(message.author.id)) {
        dmSessions.delete(message.author.id);
        prompt.edit('Session expired. Run the command again.').catch(() => {});
      }
    }, 300000);
    return;
  }

  // clear / purge - managers only
  if (cmd === 'clear' || cmd === 'purge') {
    if (!isManager(message)) return message.reply('You need to be a bot manager to use this command.');
    const amount = parseInt(args[1]);
    if (!args[1] || isNaN(amount) || amount < 1) {
      return message.reply('Specify how many messages to delete. Ex: `' + prefix + 'clear 50`');
    }
    if (amount > 300) {
      return message.reply('Maximum is **300** messages at once.');
    }
    // Delete the command message itself too
    try { await message.delete(); } catch (e) {}
    let remaining = amount;
    let totalDeleted = 0;
    while (remaining > 0) {
      const batch = Math.min(remaining, 100);
      let fetched;
      try {
        fetched = await message.channel.messages.fetch({ limit: batch });
      } catch (e) { break; }
      // bulkDelete only works on messages < 14 days old
      const deletable = fetched.filter(m => (Date.now() - m.createdTimestamp) < 12096e5);
      if (deletable.size === 0) break;
      try {
        const result = await message.channel.bulkDelete(deletable, true);
        totalDeleted += result.size;
        remaining -= result.size;
        if (result.size < batch) break;
      } catch (e) { break; }
      if (remaining > 0) await new Promise(r => setTimeout(r, 1000));
    }
    const notice = await message.channel.send('Deleted **' + totalDeleted + '** message' + (totalDeleted !== 1 ? 's' : '') + '.');
    setTimeout(() => notice.delete().catch(() => {}), 4000);
    return;
  }

  // nuke - managers only
  if (cmd === 'nuke') {
    if (!isManager(message)) return message.reply('You need to be a bot manager to use this command.');
    const ch = message.channel;
    const confirmMsg = await message.reply('are you sure? reply with `confirm` or `cancel`');
    nukeSessions.set(message.author.id, {
      channelId: ch.id,
      guildId: message.guild.id,
      confirmMsgId: confirmMsg.id,
      confirmChannelId: ch.id,
    });
    setTimeout(() => {
      if (nukeSessions.has(message.author.id)) {
        nukeSessions.delete(message.author.id);
        confirmMsg.edit('Nuke cancelled — timed out.').catch(() => {});
      }
    }, 10000);
    return;
  }

  // Rate limit for findping
  if (cmd === 'findping' || cmd === 'find') {
    const now = Date.now();
    const last = cooldowns.get(message.author.id) || 0;
    const diff = now - last;
    if (diff < COOLDOWN_MS) {
      let countdown = Math.ceil((COOLDOWN_MS - diff) / 1000);
      const cdMsg = await message.reply("Woah, You're on cooldown, try again in **" + countdown + "s**");
      const interval = setInterval(async () => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(interval);
          try { await cdMsg.delete(); } catch (e) {}
          return;
        }
        try {
          await cdMsg.edit("Woah, You're on cooldown, try again in **" + countdown + "s**");
        } catch (e) { clearInterval(interval); }
      }, 1000);
      return;
    }
    cooldowns.set(message.author.id, now);
    const mentioned = message.mentions.users.first();
    const target = mentioned || message.author;
    await handleFindPing(message, target, false);
    return;
  }

  if (cmd === 'say') {
    if (!isManager(message)) return message.reply('You need to be a bot manager to use this command.');
    const text = rawCmd.slice(3).trim();
    if (!text) return message.reply('Provide a message. Ex: `' + prefix + 'say hello world`');
    try { await message.delete(); } catch (e) {}
    await message.channel.send(text);
    return;
  }

  if (cmd === 'help') return sendHelp(message, prefix);
  if (cmd === 'credits') return sendCredits(message);
  if (cmd === 'cmds' || cmd === 'commands') return sendCommands(message, prefix);

  // --- auth setup ---
  if (fullCmd === 'auth setup') {
    if (!isBotOwner(message)) return message.reply('Only the bot owner can use this command.');
    // Create the verify channel
    let verifyChannel;
    try {
      verifyChannel = await message.guild.channels.create({
        name: 'verify',
        topic: 'Click the button below to verify.',
        reason: 'Auth setup by ' + message.author.tag,
        permissionOverwrites: [
          {
            id: message.guild.roles.everyone,
            allow: ['ViewChannel', 'ReadMessageHistory'],
            deny: ['SendMessages'],
          },
        ],
      });
    } catch (e) {
      return message.reply('Failed to create verify channel: ' + e.message);
    }
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('Verify to Never lose Touch With Us')
      .setDescription('verifying is optional, but it is for the best.')
      .setImage('https://file.garden/aeCg0yyn7Q9F4L3h/content.webp')
      .setFooter({ text: 'we will never sell, or share your data' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Verify')
        .setStyle(ButtonStyle.Link)
        .setURL(OAUTH_URL)
    );
    await verifyChannel.send({ embeds: [embed], components: [row] });
    // Sync existing guild members to unverified list
    try {
      const members = await fetchAllHumanMembers(message.guild);
      for (const member of members) {
        await fetch(AUTH_SERVER_URL + '/api/unverified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pull-secret': PULL_SECRET },
          body: JSON.stringify({ id: member.user.id, username: member.user.username }),
        }).catch(() => {});
      }
    } catch (e) {}
    await message.reply('Auth setup complete! Verify channel created: <#' + verifyChannel.id + '>');
    return;
  }

  // --- verified list ---
  if (fullCmd === 'verified list') {
    if (!isBotOwner(message)) return message.reply('Only the bot owner can use this command.');
    await sendVerifyList(message, 'verified', 1);
    return;
  }

  // --- unverified list ---
  if (fullCmd === 'unverified list') {
    if (!isBotOwner(message)) return message.reply('Only the bot owner can use this command.');
    await sendVerifyList(message, 'unverified', 1);
    return;
  }

  // --- check [userid] ---
  if (cmd === 'check') {
    if (!isBotOwner(message)) return message.reply('Only the bot owner can use this command.');
    const userId = args[1] ? args[1].replace(/[<@!>]/g, '') : null;
    if (!userId) return message.reply('Provide a user ID. Ex: `' + prefix + 'check 123456789`');
    if (await isProtectedUser(userId)) return message.reply('this user is protected.');
    try {
      const res = await fetch(AUTH_SERVER_URL + '/api/check/' + userId, {
        headers: { 'x-pull-secret': PULL_SECRET },
      });
      const data = await res.json();
      if (data.status === 'verified') {
        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('User Check')
          .addFields(
            { name: 'Username', value: data.username || 'Unknown', inline: true },
            { name: 'Status', value: '✅ Verified', inline: true },
            { name: 'IP', value: data.ip || 'Unknown', inline: true },
            { name: 'Verified At', value: data.timestamp ? '<t:' + Math.floor(new Date(data.timestamp).getTime() / 1000) + ':F>' : 'Unknown', inline: false },
          )
          .setFooter({ text: 'ID: ' + userId });
        return message.reply({ embeds: [embed] });
      } else if (data.status === 'unverified') {
        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('User Check')
          .addFields(
            { name: 'Username', value: data.username || 'Unknown', inline: true },
            { name: 'Status', value: '❌ Not Verified', inline: true },
            { name: 'Seen At', value: data.timestamp ? '<t:' + Math.floor(new Date(data.timestamp).getTime() / 1000) + ':F>' : 'Unknown', inline: false },
          )
          .setFooter({ text: 'ID: ' + userId });
        return message.reply({ embeds: [embed] });
      } else {
        return message.reply('User `' + userId + '` is not in the database.');
      }
    } catch (e) {
      return message.reply('Failed to check user: ' + e.message);
    }
  }

  // --- protect [userid] --- bot owner only ---
  if (cmd === 'protect') {
    if (!isBotOwner(message)) return message.reply('Only the bot owner can use this command.');
    const userId = args[1] ? args[1].replace(/[<@!>]/g, '') : null;
    if (!userId) return message.reply('Provide a user ID. Ex: `' + prefix + 'protect 123456789`');
    const list = await getProtectedList();
    if (list.includes(userId)) {
      await setProtectedList(list.filter(id => id !== userId));
      return message.reply('Removed protection from `' + userId + '`.');
    } else {
      list.push(userId);
      await setProtectedList(list);
      return message.reply('`' + userId + '` is now protected.');
    }
  }

  // --- pull [serverid] --- bot owner only ---
  if (cmd === 'pull') {
    if (!isBotOwner(message)) {
      return message.reply('You are not authorized to use this command.');
    }
    const guildId = args[1];
    if (!guildId || !/^\d+$/.test(guildId)) return message.reply('Provide a valid server ID. Ex: `' + prefix + 'pull 123456789`');

    // Fetch target guild name
    let targetGuildName = guildId;
    try {
      const targetGuild = await client.guilds.fetch(guildId);
      if (targetGuild) targetGuildName = targetGuild.name;
    } catch (e) {}

    const statusMsg = await message.reply('Pulling members into **' + targetGuildName + '**...');
    try {
      const res = await fetch(AUTH_SERVER_URL + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pull-secret': PULL_SECRET },
        body: JSON.stringify({ guildId }),
      });
      const data = await res.json();
      await statusMsg.edit(
        'Successfully pulled **' + data.success + '** │ Unsuccessfully pulled **' + data.fail + '**\n' +
        '-# Total in database: ' + data.total
      );
      // DM successfully pulled users
      if (data.pulledUserIds && data.pulledUserIds.length > 0) {
        for (const userId of data.pulledUserIds) {
          try {
            const user = await client.users.fetch(userId);
            await user.send(
              'we added you to **' + targetGuildName + '**.\n' +
              'since our old server likely got terminated, or is about to be.\n' +
              '-# thank you for staying in touch with us, boost & main our new server to support us.'
            );
          } catch (e) {}
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      await statusMsg.edit('Pull failed: ' + e.message);
    }
    return;
  }
});

// --- DM handler (dm clear) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.guild) return; // guild messages handled above

  const content = message.content.trim().toLowerCase();
  // Support any prefix or no prefix for dm clear since it's in DMs
  if (content === 'dm clear' || content === ',dm clear' || content === '.dm clear' || content === '!dm clear' || content === '?dm clear') {
    const dmChannel = message.channel;
    const statusMsg = await dmChannel.send('Clearing my messages...');
    let deleted = 0;
    let failed = 0;
    let lastId = undefined;

    // Fetch and delete bot messages in this DM channel
    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      let fetched;
      try {
        fetched = await dmChannel.messages.fetch(options);
      } catch (e) {
        break;
      }
      if (fetched.size === 0) break;
      const botMsgs = fetched.filter(m => m.author.id === client.user.id && m.id !== statusMsg.id);
      for (const [, msg] of botMsgs) {
        try {
          await msg.delete();
          deleted++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          failed++;
        }
      }
      lastId = fetched.last().id;
      if (fetched.size < 100) break;
    }
    try {
      await statusMsg.edit('Done. Deleted **' + deleted + '** message' + (deleted !== 1 ? 's' : '') + '.' + (failed > 0 ? ' (' + failed + ' failed)' : ''));
    } catch (e) {}
  }
});

// --- Verify list pagination interaction handler ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'vlist') return;
  const type = parts[1];
  const nav = parts[2];
  // We store current page in the embed footer
  const footer = interaction.message.embeds[0]?.footer?.text || '';
  const match = footer.match(/Page (\d+) of (\d+)/);
  let page = match ? parseInt(match[1]) : 1;
  const totalPages = match ? parseInt(match[2]) : 1;
  if (nav === 'first') page = 1;
  else if (nav === 'prev') page = Math.max(1, page - 1);
  else if (nav === 'next') page = Math.min(totalPages, page + 1);
  else if (nav === 'last') page = totalPages;
  await interaction.deferUpdate();
  await sendVerifyList(interaction, type, page, true);
});

// --- Send verified/unverified list with pagination ---
const LIST_PAGE_SIZE = 15;

async function sendVerifyList(ctx, type, page, isUpdate = false) {
  let data;
  try {
    const res = await fetch(AUTH_SERVER_URL + '/api/' + type, {
      headers: { 'x-pull-secret': PULL_SECRET },
    });
    data = await res.json();
  } catch (e) {
    const msg = 'Failed to fetch ' + type + ' list: ' + e.message;
    if (isUpdate) return ctx.editReply({ content: msg, embeds: [], components: [] });
    return ctx.reply(msg);
  }

  const protected_ = await getProtectedList();
  const entries = Object.values(data).filter(u => !protected_.includes(u.id));
  const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
  page = Math.max(1, Math.min(page, totalPages));
  const slice = entries.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);

  const color = type === 'verified' ? 0x57F287 : 0xED4245;
  const icon = type === 'verified' ? '✅' : '❌';

  let desc = '';
  if (slice.length === 0) {
    desc = 'No ' + type + ' members found.';
  } else {
    for (const u of slice) {
      const ts = u.timestamp ? '<t:' + Math.floor(new Date(u.timestamp).getTime() / 1000) + ':d>' : 'N/A';
      const ip = u.ip || 'N/A';
      const name = String(u.username || u.id || 'Unknown');
      desc += '`' + name.padEnd(20) + '` │ ' + ts + ' │ `' + ip + '`\n';
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(icon + ' ' + type.charAt(0).toUpperCase() + type.slice(1) + ' Members')
    .setDescription(desc || 'None.')
    .setFooter({ text: 'Page ' + page + ' of ' + totalPages + ' • ' + entries.length + ' total' });

  // Pagination buttons - fix duplicate custom_id when on page 1 of 1
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vlist:' + type + ':first').setLabel('⏮ First').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId('vlist:' + type + ':prev').setLabel('◀ Back').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId('vlist:' + type + ':next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
    new ButtonBuilder().setCustomId('vlist:' + type + ':last').setLabel('Last ⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
  );

  if (isUpdate) {
    return ctx.editReply({ embeds: [embed], components: [row] });
  }
  return ctx.reply({ embeds: [embed], components: [row] });
}


async function handleDmContent(message, session, content) {
  let forwardMessage = null;
  let plainText = null;

  const urlMatch = content.match(/https?:\/\/discord(?:app)?\.com\/channels\/\d+\/\d+\/\d+/);
  if (urlMatch) {
    const parsed = parseMessageUrl(urlMatch[0]);
    if (parsed) {
      try {
        const ch = await client.channels.fetch(parsed.channelId);
        const msg = await ch.messages.fetch(parsed.messageId);
        forwardMessage = msg;
      } catch (e) {
        // Can't access the message
        const retry = await message.reply("I can't access that message. Please send the message content as plain text instead.");
        dmSessions.set(message.author.id, { ...session, step: 'awaiting_content' });
        setTimeout(() => {
          if (dmSessions.has(message.author.id)) dmSessions.delete(message.author.id);
          retry.edit('Session expired.').catch(() => {});
        }, 300000);
        return;
      }
    }
  } else {
    plainText = content;
  }

  // Fetch member count for confirmation
  const guild = client.guilds.cache.get(session.guildId);
  let confirmText;
  if (session.type === 'all') {
    // Use guild.memberCount (approximate) to avoid opcode 8 gateway rate limit
    const humanCount = guild.memberCount;
    confirmText = 'are you sure? reply with `confirm` or `cancel`';
    session.memberCount = humanCount;
  } else {
    confirmText = 'are you sure? reply with `confirm` or `cancel`';
  }

  session.forwardMessage = forwardMessage;
  session.plainText = plainText;
  session.step = 'awaiting_confirm';
  dmSessions.set(message.author.id, session);

  const confirmMsg = await message.reply(confirmText);
  session.confirmMsg = confirmMsg;

  setTimeout(() => {
    if (dmSessions.has(message.author.id)) {
      dmSessions.delete(message.author.id);
      confirmMsg.edit('Session expired. No messages were sent.').catch(() => {});
    }
  }, 60000);
}

// --- Build a sendable payload from a fetched message ---
function buildForwardPayload(msg) {
  const payload = {};
  if (msg.content) payload.content = msg.content;
  if (msg.embeds && msg.embeds.length > 0) payload.embeds = msg.embeds;
  if (msg.attachments && msg.attachments.size > 0) {
    // Send attachment URLs inline so they render in DMs
    const urls = [...msg.attachments.values()].map(a => a.url).join('\n');
    payload.content = (payload.content ? payload.content + '\n' : '') + urls;
  }
  if (!payload.content && (!payload.embeds || payload.embeds.length === 0)) {
    payload.content = '[Forwarded message had no readable content]';
  }
  return payload;
}

// --- Fetch all human members via REST (chunked, avoids opcode 8 gateway rate limit) ---
async function fetchAllHumanMembers(guild) {
  const members = [];
  let lastId = undefined;
  const CHUNK = 1000;

  while (true) {
    const options = { limit: CHUNK };
    if (lastId) options.after = lastId;
    const chunk = await guild.members.list(options);
    if (chunk.size === 0) break;
    for (const [, member] of chunk) {
      if (!member.user.bot) members.push(member);
    }
    lastId = chunk.last().id;
    if (chunk.size < CHUNK) break;
    // Small pause between chunks to be safe
    await new Promise(r => setTimeout(r, 500));
  }
  return members;
}

// --- Execute DM send ---
async function executeDmSend(message, session) {
  const guild = client.guilds.cache.get(session.guildId);
  const statusMsg = await message.reply('Sending...');

  let success = 0;
  let fail = 0;

  if (session.type === 'all') {
    let humans;
    try {
      humans = await fetchAllHumanMembers(guild);
    } catch (e) {
      console.error('[fetchAllHumanMembers error]', e);
      return statusMsg.edit('Failed to fetch members. Make sure the bot has the **Server Members Intent** enabled.');
    }

    for (const member of humans) {
      try {
        if (session.forwardMessage) {
          const payload = buildForwardPayload(session.forwardMessage);
          await member.user.send(payload);
        } else {
          await member.user.send(session.plainText);
        }
        success++;
      } catch (e) {
        fail++;
      }
      // Small delay to avoid DM rate limits
      await new Promise(r => setTimeout(r, 800));
    }
  } else {
    try {
      const user = await client.users.fetch(session.targetId);
      if (session.forwardMessage) {
        const payload = buildForwardPayload(session.forwardMessage);
        await user.send(payload);
      } else {
        await user.send(session.plainText);
      }
      success++;
    } catch (e) {
      fail++;
    }
  }

  await statusMsg.edit(
    'Successfully sent to **' + success + '** member' + (success !== 1 ? 's' : '') + '.\n' +
    'Unsuccessfully sent to **' + fail + '** member' + (fail !== 1 ? 's' : '') + '.'
  );
}

// --- Auto-delete ---
function autoDelete(msg) {
  setTimeout(async () => {
    try { await msg.delete(); } catch (e) {}
  }, AUTO_DELETE_MS);
}

// --- Core: Find Ping ---
async function handleFindPing(ctx, target, isSlash) {
  const channel = ctx.channel;
  const invoker = isSlash ? ctx.user : ctx.author;

  let searchingMsg;
  if (isSlash) {
    await ctx.deferReply();
  } else {
    searchingMsg = await ctx.channel.send('searching for pings..');
  }

  let found = null;
  let foundIsGhost = false;
  let lastId = null;
  let totalScanned = 0;
  const BATCH = 100;
  const MAX_TOTAL = 10000;

  const ghosts = ghostPingCache.get(channel.id) || [];
  for (const g of ghosts) {
    if (g.mentionedIds.includes(target.id)) {
      found = g;
      foundIsGhost = true;
      break;
    }
  }

  if (!found) {
    try {
      while (totalScanned < MAX_TOTAL) {
        const options = { limit: BATCH };
        if (lastId) options.before = lastId;
        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;
        const sorted = fetched.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
        for (const msg of sorted.values()) {
          if (!isSlash && msg.id === ctx.id) continue;
          if (msg.mentions.everyone) continue;
          const mentionedIds = [...msg.mentions.users.keys()];
          if (mentionedIds.includes(target.id)) {
            found = msg;
            foundIsGhost = false;
            break;
          }
        }
        if (found) break;
        lastId = fetched.last().id;
        totalScanned += fetched.size;
        if (fetched.size < BATCH) break;
      }
    } catch (err) {
      console.error(err);
      const errMsg = 'Error fetching messages. Make sure I have Read Message History permission.';
      if (searchingMsg) try { await searchingMsg.delete(); } catch (e) {}
      if (isSlash) return ctx.editReply(errMsg);
      return ctx.reply(errMsg);
    }
  }

  if (searchingMsg) try { await searchingMsg.delete(); } catch (e) {}

  if (!found) {
    const noResult =
      'no ghostpings or pings was found within **' + totalScanned + '** messages scanned.\n' +
      "-# it probably reached my scan limit, or you're just seeing things.";
    if (isSlash) return ctx.editReply(noResult);
    const r = await ctx.reply(noResult);
    autoDelete(r);
    return;
  }

  let embed;
  let isLong = false;

  if (foundIsGhost) {
    const g = found;
    const ts = Math.floor(g.timestamp / 1000);
    const msgContent = g.content || '[No text content]';
    isLong = msgContent.length > 100;

    embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('Found it - Ghost Pinged by ' + g.authorTag)
      .addFields(
        { name: '**Ghost Pinged By**', value: '<@' + g.authorId + '>', inline: true },
        { name: '**Timestamp**', value: '<t:' + ts + ':R>', inline: true },
      )
      .setFooter({ text: 'Scan Success  •  ' + new Date(g.timestamp).toLocaleString() + '  •  ' + FOOTER });

    if (!isLong) embed.addFields({ name: '**Message**', value: msgContent });

    if (isLong) {
      const dmEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Found it - Ghost Pinged by ' + g.authorTag)
        .addFields(
          { name: '**Ghost Pinged By**', value: '<@' + g.authorId + '>', inline: true },
          { name: '**Timestamp**', value: '<t:' + ts + ':R>', inline: true },
          { name: '**Message**', value: msgContent.slice(0, 1000) },
        )
        .setFooter({ text: 'Scan Success  •  ' + new Date(g.timestamp).toLocaleString() + '  •  ' + FOOTER });
      try { await invoker.send({ embeds: [dmEmbed] }); } catch (e) {}
      const notice = isSlash
        ? await ctx.editReply('i sent you a dm since the message content was over 100 characters.')
        : await ctx.reply('i sent you a dm since the message content was over 100 characters.');
      if (!isSlash) autoDelete(notice);
      return;
    }

  } else {
    const msg = found;
    const ts = Math.floor(msg.createdTimestamp / 1000);
    const msgContent = msg.content || (msg.embeds && msg.embeds.length > 0 ? '[Embed content]' : '[No text content]');
    isLong = msgContent.length > 100;

    embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('Found it - Pinged by ' + msg.author.username)
      .addFields(
        { name: '**Pinged By**', value: '<@' + msg.author.id + '>', inline: true },
        { name: '**Timestamp**', value: '<t:' + ts + ':R>', inline: true },
        { name: '**Jump to**', value: '[Click here](' + msg.url + ')', inline: true },
      )
      .setFooter({ text: 'Scan Success  •  ' + new Date(msg.createdTimestamp).toLocaleString() + '  •  ' + FOOTER });

    if (!isLong) embed.addFields({ name: '**Message**', value: msgContent });

    if (isLong) {
      const dmEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Found it - Pinged by ' + msg.author.username)
        .addFields(
          { name: '**Pinged By**', value: '<@' + msg.author.id + '>', inline: true },
          { name: '**Timestamp**', value: '<t:' + ts + ':R>', inline: true },
          { name: '**Jump to**', value: '[Click here](' + msg.url + ')', inline: true },
          { name: '**Message**', value: msgContent.slice(0, 1000) },
        )
        .setFooter({ text: 'Scan Success  •  ' + new Date(msg.createdTimestamp).toLocaleString() + '  •  ' + FOOTER });
      try { await invoker.send({ embeds: [dmEmbed] }); } catch (e) {}
      const notice = isSlash
        ? await ctx.editReply('i sent you a dm since the message content was over 100 characters.')
        : await ctx.reply('i sent you a dm since the message content was over 100 characters.');
      if (!isSlash) autoDelete(notice);
      return;
    }
  }

  let sent;
  if (isSlash) {
    sent = await ctx.editReply({ embeds: [embed] });
  } else {
    sent = await ctx.reply({ embeds: [embed] });
    autoDelete(sent);
  }
}

// --- Help ---
async function sendHelp(ctx, prefix) {
  await ctx.reply('https://discord.gg/RHsanjvYC8');
}

// --- Credits ---
async function sendCredits(ctx) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Lured.rest x Credits')
    .setDescription('Founded & Owned by <@1390368634907525180>')
    .setFooter({ text: 'check out https://lured.rest' });
  const sent = await ctx.reply({ embeds: [embed] });
  autoDelete(sent);
}

// --- Commands list ---
async function sendCommands(ctx, prefix) {
  await ctx.reply(
    '`' + prefix + 'findping`\n' +
    '`' + prefix + 'auth setup`\n' +
    '`' + prefix + 'verified list`\n' +
    '`' + prefix + 'unverified list`\n' +
    '`' + prefix + 'check [userid]`\n' +
    '`' + prefix + 'pull [serverid]`\n' +
    '`' + prefix + 'dm all`\n' +
    '`' + prefix + 'dm @user`\n' +
    '`dm clear` *(in bot DMs)*\n' +
    '`' + prefix + 'clear [amount]`\n' +
    '`' + prefix + 'purge [amount]`\n' +
    '`' + prefix + 'nuke`\n' +
    '`' + prefix + 'manager add/remove/list`\n' +
    '`' + prefix + 'prefix [symbol]`\n' +
    '`' + prefix + 'help`\n' +
    '`' + prefix + 'cmds`\n' +
    '`' + prefix + 'credits`'
  );
}

// --- Error handler (prevents unhandled error crashes) ---
client.on('error', (err) => {
  console.error('[Client Error]', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('[Unhandled Rejection]', err);
});

// --- Login ---
const http = require('http');
http.createServer((req, res) => res.end('ok')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);

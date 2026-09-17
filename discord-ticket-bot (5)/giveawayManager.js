const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const { getInviteCount } = require("./inviteTracker");

const giveaways = new Map();

// Giveaways are kept in-memory for speed, but mirrored to disk so an app
// restart / redeploy (or editing this file) doesn't wipe out giveaways
// that are still running. Every mutation below calls saveGiveaways().
//
// IMPORTANT on Railway (and similar hosts): the app's own folder is
// wiped and rebuilt fresh on every deploy, so a file saved next to this
// script would get lost on every update. Set the DATA_DIR environment
// variable to a path inside a Railway Volume (Settings → Volumes) and
// this will save there instead, surviving deploys. Falls back to this
// folder if DATA_DIR isn't set (fine for local/VPS use where the folder
// itself persists).
const DATA_DIR = process.env.DATA_DIR || __dirname;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) {
  console.error("Could not create giveaway data directory:", error);
}

const DATA_FILE = path.join(DATA_DIR, "giveaways.json");

function serializeGiveaway(giveaway) {
  return {
    ...giveaway,
    entries: [...giveaway.entries],
    // Timers/intervals aren't serializable and get rebuilt on load.
    refreshInterval: undefined
  };
}

function saveGiveaways() {
  try {
    const plain = {};

    for (const [id, giveaway] of giveaways) {
      plain[id] = serializeGiveaway(giveaway);
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(plain, null, 2));
  } catch (error) {
    console.error("Could not save giveaways to disk:", error);
  }
}

function loadGiveawaysFromDisk() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};

    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("Could not load giveaways from disk:", error);
    return {};
  }
}

// setTimeout only accepts a 32-bit signed int (~24.8 days) before it overflows
// and fires immediately. Since giveaways can run up to 30 days, we chain
// timeouts so long giveaways actually wait the full duration instead of
// ending early / looking "stuck".
const MAX_TIMEOUT_MS = 2147483647;

function scheduleTimeout(callback, delay) {
  if (delay > MAX_TIMEOUT_MS) {
    return setTimeout(
      () => scheduleTimeout(callback, delay - MAX_TIMEOUT_MS),
      MAX_TIMEOUT_MS
    );
  }
  return setTimeout(callback, delay);
}

function parseDuration(input) {
  const match = input
    .toLowerCase()
    .trim()
    .match(/^(\d+)\s*(s|m|h|d|w)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

// Discord's <t:...:R> tag only updates in coarse steps (minutes at a time
// past the first minute), so on short giveaways it can look frozen. This
// builds a literal "Xm Ys" string from the actual remaining time, so it
// genuinely counts down each time we refresh the embed.
function formatTimeLeft(ms) {
  if (ms <= 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);

  return parts.slice(0, 2).join(" ");
}

// Every 2 invites a member has brought in = 1 extra giveaway entry, on top
// of the 1 entry they already get for joining. Only applies to giveaways
// created with invite_entries:true.
function getEntryWeight(giveaway, userId) {
  if (!giveaway.inviteEntries) return 1;

  const invites = getInviteCount(giveaway.guildId, userId);
  return 1 + Math.floor(invites / 2);
}

// Picks `count` unique winners from `entrants` (an array of user IDs).
// When giveaway.inviteEntries is set, each entrant is weighted by
// getEntryWeight() (1 + floor(invites/2)) so heavier inviters are more
// likely — but never guaranteed, and never picked more than once — to win.
function pickWeightedWinners(giveaway, entrants, count) {
  const pool = [];

  for (const userId of entrants) {
    const weight = getEntryWeight(giveaway, userId);
    for (let i = 0; i < weight; i++) pool.push(userId);
  }

  const winners = [];

  while (winners.length < count && pool.length > 0) {
    const randomIndex = Math.floor(Math.random() * pool.length);
    const winnerId = pool[randomIndex];

    winners.push(winnerId);

    // Remove every copy of this winner so they can't be drawn twice.
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i] === winnerId) pool.splice(i, 1);
    }
  }

  return winners;
}

function createGiveawayEmbed(giveaway) {
  const hasWinners = giveaway.winners.length > 0;
  const endTimestamp = Math.floor(giveaway.endTime / 1000);
  const timeLeft = formatTimeLeft(giveaway.endTime - Date.now());

  const lines = [
    hasWinners ? "" : "Click the button below to enter!",
    "",
    hasWinners
      ? `**Winner(s):** ${giveaway.winners.map(id => `<@${id}>`).join(" ")}`
      : `**Winners:** ${giveaway.winnerCount}`,
    `**Hosted by:** ${giveaway.host}`,
    // Once the giveaway has ended, drop the "Ends:" line entirely
    // (the countdown box just goes away, like a timer that's done)
    // instead of leaving a relative timestamp behind.
    ...(hasWinners ? [] : [`**Ends:** \`${timeLeft}\``]),
    ...(giveaway.inviteEntries && !hasWinners
      ? ["", "🔗 Every **2 invites** you bring gets you **+1 extra entry**!"]
      : []),
    "",
    `<t:${endTimestamp}:F>`
  ];

  return new EmbedBuilder()
    .setColor(0x0000ff)
    .setTitle(`${giveaway.prize}`)
    .setDescription(lines.join("\n"));
}

function createJoinButton(giveaway, disabled = false) {
  const button = new ButtonBuilder()
    .setCustomId(`giveaway_join_${giveaway.id}`)
    .setLabel(` 🎉 Join Giveaway (${giveaway.entries.size})`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(button);
}

function createLeaveButton(giveaway) {
  const button = new ButtonBuilder()
    .setCustomId(`giveaway_leave_${giveaway.id}`)
    .setLabel("Leave Giveaway")
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder().addComponents(button);
}

// Discord's <t:...:R> tag DOES tick down on its own client-side, but if the
// message never gets edited some clients cache/stop refreshing it and it
// visually "sticks". We force a re-render every 9s so it never freezes,
// on top of the live client-side ticking.
function startCountdownRefresh(client, giveawayId) {
  const giveaway = giveaways.get(giveawayId);
  if (!giveaway) return;

  giveaway.refreshInterval = setInterval(async () => {
    const g = giveaways.get(giveawayId);

    if (!g || g.winners.length > 0 || Date.now() >= g.endTime) {
      clearInterval(g?.refreshInterval);
      return;
    }

    try {
      const channel = client.channels.cache.get(g.channelId);
      if (!channel) return;

      const message = await channel.messages.fetch(g.messageId);

      await message.edit({
        embeds: [createGiveawayEmbed(g)],
        components: [createJoinButton(g)]
      });
    } catch (error) {
      console.error("Giveaway countdown refresh error:", error);
    }
  }, 9 * 1000);
}

// Guards against the SAME /gcreate interaction being processed twice, which
// happens if two copies of the bot end up connected at once (e.g. an old
// deploy that never got killed) — Discord delivers the interaction to every
// connected session, so both would otherwise post their own giveaway
// message and send their own DM. This claims the interaction on disk (so it
// works even across two separate processes sharing DATA_DIR), and the
// second process to try loses the race and bails out quietly.
const CLAIMED_DIR = path.join(DATA_DIR, "claimed_interactions");

function claimInteraction(interactionId) {
  try {
    fs.mkdirSync(CLAIMED_DIR, { recursive: true });
    const claimFile = path.join(CLAIMED_DIR, `${interactionId}.lock`);
    // "wx" fails with EEXIST if the file is already there — this is an
    // atomic create, so it's safe even if two processes race to call it
    // at the same instant.
    fs.writeFileSync(claimFile, String(Date.now()), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    // If claiming fails for some other reason (e.g. read-only disk), don't
    // block giveaways from working — just let it through unclaimed.
    console.error("Could not claim interaction (continuing anyway):", error.message);
    return true;
  }
}

async function startGiveaway({ interaction, prize, winners, duration, inviteEntries = false }) {
  if (!claimInteraction(interaction.id)) {
    // Another process already handled this exact /gcreate invocation.
    return { success: false, error: "This giveaway was already started.", alreadyClaimed: true };
  }

  const durationMs = parseDuration(duration);

  if (!durationMs) {
    return {
      success: false,
      error: "Invalid duration. Use `10m`, `1h`, `7d` or `1w`."
    };
  }

  if (durationMs < 10000) {
    return {
      success: false,
      error: "The giveaway must last at least 10 seconds."
    };
  }

  if (durationMs > 30 * 24 * 60 * 60 * 1000) {
    return {
      success: false,
      error: "The giveaway cannot last longer than 30 days."
    };
  }

  const giveawayId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const giveaway = {
    id: giveawayId,

    guildId: interaction.guild.id,
    channelId: interaction.channel.id,
    messageId: null,

    prize,
    winnerCount: winners,

    hostId: interaction.user.id,
    host: `<@${interaction.user.id}>`,

    endTime: Date.now() + durationMs,

    // When true, winner selection weights each entrant by 1 + floor(their
    // invites / 2) — see getEntryWeight() above.
    inviteEntries: Boolean(inviteEntries),

    entries: new Set(),
    winners: [],

    refreshInterval: null
  };

  const giveawayMessage = await interaction.channel.send({
    embeds: [createGiveawayEmbed(giveaway)],
    components: [createJoinButton(giveaway)]
  });

  giveaway.messageId = giveawayMessage.id;

  giveaways.set(giveawayId, giveaway);

  saveGiveaways();

  scheduleTimeout(() => {
    endGiveaway(interaction.client, giveawayId).catch(console.error);
  }, durationMs);

  startCountdownRefresh(interaction.client, giveawayId);

  // DM the host their giveaway ID (needed for /greroll later).
  try {
    await interaction.user.send({
      content:
        `🎉 Your giveaway for **${prize}** has started in **${interaction.guild.name}**!\n` +
        `**Giveaway ID:** \`${giveawayId}\`\n` +
        `Keep this ID — you'll need it to run \`/greroll giveawayid:${giveawayId}\` if you ever need to reroll a winner.`
    });
  } catch (error) {
    console.error("Could not DM giveaway host (DMs may be closed):", error);
  }

  return { success: true, giveawayId };
}

async function joinGiveaway(interaction, giveawayId) {
  const giveaway = giveaways.get(giveawayId);

  if (!giveaway) {
    return interaction.reply({
      content: "❌ This giveaway no longer exists.",
      ephemeral: true
    });
  }

  if (Date.now() >= giveaway.endTime) {
    return interaction.reply({
      content: "❌ This giveaway has already ended.",
      ephemeral: true
    });
  }

  if (giveaway.entries.has(interaction.user.id)) {
    return interaction.reply({
      content: "You already joined the giveaway",
      components: [createLeaveButton(giveaway)],
      ephemeral: true
    });
  }

  giveaway.entries.add(interaction.user.id);

  saveGiveaways();

  // Reply immediately — Discord only allows ~3s to acknowledge an
  // interaction, and fetching + editing the public giveaway message can
  // sometimes take longer than that (rate limits, slow API responses).
  // Doing the reply first means the button always responds instantly;
  // the entry-count refresh on the public message happens right after,
  // in the background.
  await interaction.reply({
    content: "You joined the giveaway",
    components: [createLeaveButton(giveaway)],
    ephemeral: true
  });

  try {
    const channel = interaction.client.channels.cache.get(giveaway.channelId);

    if (channel) {
      const message = await channel.messages.fetch(giveaway.messageId);

      await message.edit({
        embeds: [createGiveawayEmbed(giveaway)],
        components: [createJoinButton(giveaway)]
      });
    }
  } catch (error) {
    console.error("Giveaway update error:", error);
  }
}

async function leaveGiveaway(interaction, giveawayId) {
  const giveaway = giveaways.get(giveawayId);

  if (!giveaway) {
    await interaction.reply({
      content: "❌ This giveaway no longer exists.",
      ephemeral: true
    });
    return { success: false };
  }

  if (Date.now() >= giveaway.endTime) {
    await interaction.reply({
      content: "❌ This giveaway has already ended.",
      ephemeral: true
    });
    return { success: false };
  }

  if (!giveaway.entries.has(interaction.user.id)) {
    await interaction.reply({
      content: "❌ You are not entered in this giveaway.",
      ephemeral: true
    });
    return { success: false };
  }

  giveaway.entries.delete(interaction.user.id);

  saveGiveaways();

  // Same ordering as joinGiveaway above — reply first so the button never
  // times out, then refresh the public message's entry count.
  await interaction.reply({
    content: "You left the giveaway",
    components: [createJoinButton(giveaway)],
    ephemeral: true
  });

  try {
    const channel = interaction.client.channels.cache.get(giveaway.channelId);

    if (channel) {
      const message = await channel.messages.fetch(giveaway.messageId);

      await message.edit({
        embeds: [createGiveawayEmbed(giveaway)],
        components: [createJoinButton(giveaway)]
      });
    }
  } catch (error) {
    console.error("Giveaway update error:", error);
  }

  return { success: true };
}

async function endGiveaway(client, giveawayId) {
  const giveaway = giveaways.get(giveawayId);

  if (!giveaway) return;

  if (giveaway.winners.length > 0) return;

  if (giveaway.refreshInterval) {
    clearInterval(giveaway.refreshInterval);
    giveaway.refreshInterval = null;
  }

  const entries = [...giveaway.entries];
  const winners = pickWeightedWinners(giveaway, entries, giveaway.winnerCount);

  giveaway.winners = winners;

  saveGiveaways();

  const channel = client.channels.cache.get(giveaway.channelId);

  if (!channel) return;

  let winnerText;

  if (winners.length === 0) {
    winnerText = `🎉 **${giveaway.prize}**\n\n❌ **No one entered this giveaway.**`;
  } else {
    const winnerMentions = winners.map(id => `<@${id}>`).join(" ");
    winnerText = `🎉 ${winnerMentions} **you won ${giveaway.prize}!**`;
  }

  // No claim button here — the winner announcement is just a plain
  // message. If you want staff notified to hand over the prize, do that
  // manually (or add your own follow-up message here).
  await channel.send({ content: winnerText });

  // Keep the original giveaway message up (with the final embed and a
  // disabled join button) instead of stripping its components away.
  try {
    const originalMessage = await channel.messages.fetch(giveaway.messageId);

    await originalMessage.edit({
      embeds: [createGiveawayEmbed(giveaway)],
      components: [createJoinButton(giveaway, true)]
    });
  } catch (error) {
    console.error("Could not update the giveaway message after it ended:", error);
  }
}

async function rerollGiveaway(interaction, giveawayId) {
  const giveaway = giveaways.get(giveawayId);

  if (!giveaway) {
    return interaction.reply({
      content: "❌ This giveaway no longer exists.",
      ephemeral: true
    });
  }

  if (giveaway.winners.length === 0) {
    return interaction.reply({
      content: "❌ This giveaway hasn't ended yet, so there's nothing to reroll.",
      ephemeral: true
    });
  }

  const entries = [...giveaway.entries];

  if (entries.length === 0) {
    return interaction.reply({
      content: "❌ There are no entries to pick a new winner from.",
      ephemeral: true
    });
  }

  const winnerCount = Math.min(giveaway.winnerCount, entries.length);
  const newWinners = pickWeightedWinners(giveaway, entries, winnerCount);

  giveaway.winners = newWinners;

  saveGiveaways();

  const winnerMentions = newWinners.map(id => `<@${id}>`).join(" ");

  const channel = interaction.client.channels.cache.get(giveaway.channelId);

  if (channel) {
    await channel.send({
      content: `🎉 New winner(s) for **${giveaway.prize}**: ${winnerMentions}!`
    });

    try {
      const originalMessage = await channel.messages.fetch(giveaway.messageId);

      await originalMessage.edit({
        embeds: [createGiveawayEmbed(giveaway)],
        components: [createJoinButton(giveaway, true)]
      });
    } catch (error) {
      console.error("Could not update the giveaway message after reroll:", error);
    }
  }

  return interaction.reply({
    content: `✅ Rerolled! New winner(s): ${winnerMentions}`,
    ephemeral: true
  });
}

// Restores giveaways from disk on startup so an app restart / redeploy
// (or editing giveawayManager.js) doesn't kill giveaways that were still
// running: entries come back as a Set, still-running giveaways get their
// end timer + countdown refresh re-armed (ending immediately if their time
// already passed while the bot was offline), and already-ended ones just
// get restored as-is so /greroll keeps working.
async function initGiveaways(client) {
  const stored = loadGiveawaysFromDisk();
  const ids = Object.keys(stored);

  for (const id of ids) {
    const data = stored[id];

    const giveaway = {
      ...data,
      entries: new Set(data.entries || []),
      refreshInterval: null
    };

    giveaways.set(id, giveaway);

    if (giveaway.winners.length > 0) {
      // Already ended before restart — nothing to schedule, just keep
      // it around so /greroll still works.
      continue;
    }

    const remaining = giveaway.endTime - Date.now();

    if (remaining <= 0) {
      endGiveaway(client, id).catch(console.error);
    } else {
      scheduleTimeout(() => {
        endGiveaway(client, id).catch(console.error);
      }, remaining);

      startCountdownRefresh(client, id);
    }
  }

  console.log(`✅ Giveaway manager initialized (${giveaways.size} active giveaways restored).`);
}

module.exports = {
  initGiveaways,
  startGiveaway,
  joinGiveaway,
  leaveGiveaway,
  rerollGiveaway
};

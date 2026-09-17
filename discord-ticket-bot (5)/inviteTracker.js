// Tracks how many *other people* each member has invited into the server,
// so features like /gcreate's bonus-entries-per-invite option have a real
// invite count to work from.
//
// How it works: Discord doesn't send "member X used invite Y" directly, so
// we cache every invite's use-count per guild, and whenever someone joins we
// re-fetch invites and see which one's use-count went up by 1 — that invite's
// creator is credited with the join. This needs the bot to have the
// "Manage Server" permission (required to read invite use-counts at all).
//
// Counts are persisted to disk (mirrors the pattern giveawayManager.js
// uses) so a restart/redeploy doesn't wipe everyone's invite counts.

const fs = require("fs");
const path = require("path");

// Same Railway-volume note as giveawayManager.js: set DATA_DIR to a
// persistent volume path in production, otherwise this falls back to
// living next to the script (fine for VPS use).
const DATA_DIR = process.env.DATA_DIR || __dirname;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) {
  console.error("Could not create invite-tracker data directory:", error);
}

const DATA_FILE = path.join(DATA_DIR, "invites.json");

// guildId -> Map<inviteCode, uses>
const inviteCache = new Map();

// guildId -> { userId: count }
let inviteCounts = loadCountsFromDisk();

function loadCountsFromDisk() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("Could not load invite counts from disk:", error);
    return {};
  }
}

function saveCountsToDisk() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteCounts, null, 2));
  } catch (error) {
    console.error("Could not save invite counts to disk:", error);
  }
}

// Fetches and caches every invite's current use-count for a guild. Call
// this on ready for every guild the bot is in, and again after handling a
// join (so the next join compares against fresh numbers).
async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    const codeToUses = new Map();
    for (const invite of invites.values()) {
      codeToUses.set(invite.code, invite.uses ?? 0);
    }

    inviteCache.set(guild.id, codeToUses);
  } catch (error) {
    // Most common cause: the bot is missing "Manage Server" in this guild.
    console.error(`Could not cache invites for guild ${guild.id} (needs Manage Server permission):`, error.message);
  }
}

// Call this from your guildMemberAdd handler. Figures out who invited the
// new member (if possible) and credits them +1 invite.
async function handleMemberJoin(member) {
  if (member.user.bot) return; // Bots joining don't count as an invite entry.

  const guild = member.guild;
  const before = inviteCache.get(guild.id);

  let freshInvites;
  try {
    freshInvites = await guild.invites.fetch();
  } catch (error) {
    console.error(`Could not fetch invites on join for guild ${guild.id}:`, error.message);
    return;
  }

  let usedInvite = null;

  if (before) {
    for (const invite of freshInvites.values()) {
      const previousUses = before.get(invite.code) ?? 0;
      if ((invite.uses ?? 0) > previousUses) {
        usedInvite = invite;
        break;
      }
    }
  }

  // Re-cache with the fresh numbers regardless, so the next join compares
  // correctly even if we couldn't identify this one (e.g. vanity URL, or
  // the very first join after a bot restart with no prior cache).
  const codeToUses = new Map();
  for (const invite of freshInvites.values()) {
    codeToUses.set(invite.code, invite.uses ?? 0);
  }
  inviteCache.set(guild.id, codeToUses);

  if (!usedInvite || !usedInvite.inviter) return;

  const inviterId = usedInvite.inviter.id;
  if (inviterId === member.id) return; // Safety net, shouldn't normally happen.

  if (!inviteCounts[guild.id]) inviteCounts[guild.id] = {};
  inviteCounts[guild.id][inviterId] = (inviteCounts[guild.id][inviterId] || 0) + 1;

  saveCountsToDisk();
}

// Total invites credited to a user in a guild.
function getInviteCount(guildId, userId) {
  return inviteCounts[guildId]?.[userId] || 0;
}

module.exports = {
  cacheGuildInvites,
  handleMemberJoin,
  getInviteCount
};

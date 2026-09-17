// Tracks how many invites each member has *created* (sent) in a guild, so
// features like /gcreate's bonus-entries-per-invite option have a real
// invite count to work from.
//
// This counts invite creation, not successful joins — the invite doesn't
// need to be used by anyone. Creating the same invite twice, or inviting
// the same person twice, both still count (each inviteCreate is credited
// independently). Counting per-user is capped at MAX_COUNTED_INVITES so it
// can't be farmed past that by spamming invite creation.
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

// Invites beyond this many, per user per guild, stop being counted.
const MAX_COUNTED_INVITES = 2;

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

// Call this from your client's "inviteCreate" event. Credits whoever
// created the invite +1, up to MAX_COUNTED_INVITES — the invite doesn't
// need to ever be used/joined for it to count.
async function handleInviteCreate(invite) {
  const inviter = invite.inviter;
  if (!inviter || inviter.bot) return;

  const guildId = invite.guildId || invite.guild?.id;
  if (!guildId) return;

  if (!inviteCounts[guildId]) inviteCounts[guildId] = {};

  const current = inviteCounts[guildId][inviter.id] || 0;
  if (current >= MAX_COUNTED_INVITES) return; // Already at the cap.

  inviteCounts[guildId][inviter.id] = current + 1;
  saveCountsToDisk();
}

// Total invites credited to a user in a guild (already capped at
// MAX_COUNTED_INVITES).
function getInviteCount(guildId, userId) {
  return inviteCounts[guildId]?.[userId] || 0;
}

module.exports = {
  handleInviteCreate,
  getInviteCount,
  MAX_COUNTED_INVITES
};

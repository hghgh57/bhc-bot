// =====================================================================
// AFK STATUS
// ,afk [reason] sets the sender as AFK. Whenever they're @mentioned by
// someone else, the bot lets the mentioner know they're AFK (and why).
// Sending any other message clears their AFK status automatically.
//
// Storage is in-memory only (a Map), so AFK statuses are lost on
// restart — that's fine, since a restart is itself a kind of "back".
// =====================================================================

// userId -> { reason, since }
const afkUsers = new Map();

function setAfk(userId, reason) {
  afkUsers.set(userId, { reason, since: Date.now() });
}

function clearAfk(userId) {
  return afkUsers.delete(userId);
}

function getAfk(userId) {
  return afkUsers.get(userId) || null;
}

module.exports = { setAfk, clearAfk, getAfk };

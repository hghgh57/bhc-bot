// channelId -> claimer's user id. In-memory only — same lifetime as the bot
// process. Used to lock claim/close/unclaim down to the claimer, the ticket
// owner, and the bypass role once a service ticket has been claimed, and
// (via /close) so a slash command can check the same claim lock the Close
// button does.
const claims = new Map();

function getClaim(channelId) {
  return claims.get(channelId);
}

function setClaim(channelId, userId) {
  claims.set(channelId, userId);
}

function deleteClaim(channelId) {
  claims.delete(channelId);
}

module.exports = { getClaim, setClaim, deleteClaim };

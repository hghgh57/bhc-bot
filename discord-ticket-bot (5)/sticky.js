// =====================================================================
// STICKY MESSAGES
// /sticky posts a plain-text message that stays at the bottom of the
// channel: every time someone else sends a message, the old sticky is
// deleted and a fresh copy is posted underneath it. /unstick removes it.
//
// Storage is in-memory only (a Map), so stickies are lost on restart —
// re-run /sticky after a restart if you need them to persist.
// =====================================================================

// channelId -> { content, messageId, posting }
const stickies = new Map();

async function setSticky(channel, content) {
  // Replace any existing sticky in this channel first.
  await removeSticky(channel);

  const message = await channel.send({ content });
  stickies.set(channel.id, { content, messageId: message.id, posting: false });
  return message;
}

async function removeSticky(channel) {
  const sticky = stickies.get(channel.id);
  if (!sticky) return false;

  stickies.delete(channel.id);

  const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
  if (old) await old.delete().catch(() => {});

  return true;
}

function hasSticky(channelId) {
  return stickies.has(channelId);
}

// Called for every non-bot guild message; reposts the sticky underneath
// it if the channel has one.
async function handleMessageForSticky(message) {
  const sticky = stickies.get(message.channelId);
  if (!sticky) return;
  if (sticky.posting) return; // a repost is already in flight, don't stack them

  sticky.posting = true;
  try {
    const channel = message.channel;
    const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});

    const fresh = await channel.send({ content: sticky.content });
    sticky.messageId = fresh.id;
  } catch (err) {
    console.error(`Failed to repost sticky in #${message.channel?.name}:`, err);
  } finally {
    sticky.posting = false;
  }
}

module.exports = { setSticky, removeSticky, hasSticky, handleMessageForSticky };

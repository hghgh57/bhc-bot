// =====================================================================
// SNIPE
// Keeps track of the most recently deleted message in each channel so
// staff can recover it with `,s`. `,cs` clears the stored snipe.
//
// Storage is in-memory only (a Map), so history is lost on restart and
// each channel only ever remembers its single most recent deletion —
// that's intentional and keeps this lightweight.
// =====================================================================

const { EmbedBuilder } = require("discord.js");
const config = require("./config");

// channelId -> { content, authorTag, authorId, avatarURL, attachments, deletedAt }
const snipes = new Map();

// True if the message's author has a role that's exempt from being sniped.
function hasSnipeBypassRole(message) {
  const member = message.member || message.guild?.members.cache.get(message.author?.id);
  if (!member) return false;
  return config.snipeBypassRoles.some(roleId => member.roles.cache.has(roleId));
}

function recordDeletedMessage(message) {
  // Ignore messages we can't read the content of (e.g. uncached partials)
  // and ignore bot messages so the bot doesn't snipe its own embeds.
  if (!message || message.partial) return;
  if (message.author?.bot) return;
  if (hasSnipeBypassRole(message)) return;

  snipes.set(message.channelId, {
    content: message.content || "",
    authorTag: message.author?.tag || "Unknown user",
    authorId: message.author?.id || null,
    avatarURL: message.author?.displayAvatarURL?.() || null,
    attachments: [...message.attachments.values()].map(a => a.url),
    deletedAt: Date.now()
  });
}

function clearSnipe(channelId) {
  return snipes.delete(channelId);
}

function getSnipe(channelId) {
  return snipes.get(channelId) || null;
}

function buildSnipeEmbed(snipe) {
  const embed = new EmbedBuilder()
    .setColor("#F04747")
    .setAuthor({ name: snipe.authorTag, iconURL: snipe.avatarURL || undefined })
    .setDescription(snipe.content || "*(no text content)*")
    .setFooter({ text: "Deleted" })
    .setTimestamp(snipe.deletedAt);

  if (snipe.attachments.length) {
    embed.setImage(snipe.attachments[0]);
    if (snipe.attachments.length > 1) {
      embed.addFields({ name: "Other attachments", value: snipe.attachments.slice(1).join("\n") });
    }
  }

  return embed;
}

module.exports = { recordDeletedMessage, clearSnipe, getSnipe, buildSnipeEmbed };

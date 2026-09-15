const { EmbedBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");

// =====================================================================
// REACTION ROLES
// The role/emoji list itself lives in config.js. All this file tracks is
// WHICH message(s) are actually a reaction-role panel, so a random
// message elsewhere that happens to get a 🎉 reaction doesn't hand out
// roles. That list is mirrored to disk (same approach as
// giveawayManager.js) so a restart/redeploy doesn't forget about a panel
// that's already posted.
//
// Set the DATA_DIR environment variable to a path inside a Railway
// Volume (Settings -> Volumes) so this survives deploys. Falls back to
// this folder if DATA_DIR isn't set (fine for local/VPS use).
// =====================================================================
const DATA_DIR = process.env.DATA_DIR || __dirname;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) {
  console.error("Could not create reaction-roles data directory:", error);
}

const DATA_FILE = path.join(DATA_DIR, "reactionRolePanels.json");

let panelMessageIds = new Set();

function loadPanelsFromDisk() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    panelMessageIds = new Set(raw);
  } catch (error) {
    console.error("Could not load reaction-role panels from disk:", error);
  }
}
loadPanelsFromDisk();

function savePanels() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify([...panelMessageIds], null, 2));
  } catch (error) {
    console.error("Could not save reaction-role panels to disk:", error);
  }
}

// A roleId still sitting at its placeholder ("..._ID") means it hasn't
// been configured yet — treat it as "no role" everywhere.
function isConfigured(entry) {
  return Boolean(entry.roleId) && !entry.roleId.endsWith("_ID");
}

function isReactionRolePanel(messageId) {
  return panelMessageIds.has(messageId);
}

// Matches a raw reaction's emoji against config.reactionRoles. Works for
// unicode emoji (reaction.emoji.name, e.g. "🎉") and also for a custom
// emoji if you ever swap one of the entries in config.js to use its ID
// instead.
function findRoleForEmoji(emoji) {
  return config.reactionRoles.find(r => r.emoji === emoji.name || r.emoji === emoji.id);
}

async function sendReactionRolePanel(channel) {
  const lines = config.reactionRoles.map(r => {
    const mention = isConfigured(r) ? `<@&${r.roleId}> ` : "";
    return `**${r.emoji}${r.label}**\n> ${mention}${r.description}`;
  });

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setDescription(lines.join("\n\n"));

  const message = await channel.send({ embeds: [embed] });

  for (const r of config.reactionRoles) {
    await message.react(r.emoji).catch(err => console.error(`Failed to react with ${r.emoji}:`, err));
  }

  panelMessageIds.add(message.id);
  savePanels();
  return message;
}

module.exports = { sendReactionRolePanel, isReactionRolePanel, findRoleForEmoji };

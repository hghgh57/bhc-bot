const { EmbedBuilder } = require("discord.js");
const config = require("./config");

// 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11-13 -> "th", etc.
function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

async function sendWelcomeMessage(member) {
  if (!config.welcome.channel) return;
  const channel = await member.guild.channels.fetch(config.welcome.channel).catch(() => null);
  if (!channel) return;

  const memberNumber = ordinal(member.guild.memberCount);

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setDescription(config.welcome.description);

  await channel.send({
    content: `Welcome to ${member.guild.name} ${member}, you are the ${memberNumber} member to join the server!`,
    embeds: [embed]
  }).catch(() => {});
}

module.exports = { sendWelcomeMessage };

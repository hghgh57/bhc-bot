const { SlashCommandBuilder } = require("discord.js");
const { startGiveaway } = require("../giveawayManager");
const { isStaff } = require("../utils");

// Explicitly allowed regardless of isStaff/config.staffRole, so this keeps
// working even if that config value ever changes.
const GIVEAWAY_ROLE_ID = "1510924042469900318";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gcreate")
    .setDescription("Start a giveaway.")
    .setDefaultMemberPermissions(null)
    .addStringOption(option =>
      option
        .setName("prize")
        .setDescription("The giveaway prize.")
        .setRequired(true)
        .setMaxLength(256)
    )
    .addIntegerOption(option =>
      option
        .setName("winners")
        .setDescription("How many winners.")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("Examples: 7d, 24h, 30m, 1h")
        .setRequired(true)
        .setMaxLength(20)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ This command can only be used in a server.",
        ephemeral: true
      });
    }

    const hasRole = interaction.member.roles.cache.has(GIVEAWAY_ROLE_ID);

    if (!isStaff(interaction.member) && !hasRole) {
      return interaction.reply({
        content: "❌ You need to be staff to use this command.",
        ephemeral: true
      });
    }

    const prize = interaction.options.getString("prize", true).trim();
    const winners = interaction.options.getInteger("winners", true);
    const duration = interaction.options.getString("duration", true);

    if (!prize) {
      return interaction.reply({
        content: "❌ Please provide a giveaway prize.",
        ephemeral: true
      });
    }

    let result;

    try {
      result = await startGiveaway({ interaction, prize, winners, duration });
    } catch (error) {
      console.error("/gcreate error:", error);
      return interaction.reply({
        content: "❌ Failed to start the giveaway. Check the bot console for the error.",
        ephemeral: true
      });
    }

    if (!result.success) {
      return interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true
      });
    }

    return interaction.reply({
      content: `✅ Giveaway started!\n**Giveaway ID:** \`${result.giveawayId}\``,
      ephemeral: true
    });
  }
};

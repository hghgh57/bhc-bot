const { SlashCommandBuilder } = require("discord.js");
const { rerollGiveaway } = require("../giveawayManager");
const { isStaff } = require("../utils");

// Explicitly allowed regardless of isStaff/config.staffRole, so this keeps
// working even if that config value ever changes.
const GIVEAWAY_ROLE_ID = "1510924042469900318";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("greroll")
    .setDescription("Reroll the winner(s) of a giveaway.")
    .setDefaultMemberPermissions(null)
    .addStringOption(option =>
      option
        .setName("giveawayid")
        .setDescription("The giveaway ID (DM'd to the host when it started).")
        .setRequired(true)
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

    const giveawayId = interaction.options.getString("giveawayid", true).trim();

    try {
      await rerollGiveaway(interaction, giveawayId);
    } catch (error) {
      console.error("/greroll error:", error);

      const payload = {
        content: "❌ Failed to reroll the giveaway. Check the bot console for the error.",
        ephemeral: true
      };

      if (interaction.deferred || interaction.replied) {
        return interaction.followUp(payload);
      }

      return interaction.reply(payload);
    }
  }
};

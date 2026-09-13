const { SlashCommandBuilder } = require("discord.js");
const { isStaff } = require("../utils");
const { removeSticky } = require("../sticky");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unstick")
    .setDescription("Remove the sticky message from this channel"),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    let removed = false;
    try {
      removed = await removeSticky(interaction.channel);
    } catch (err) {
      console.error("Failed to remove sticky:", err);
      return interaction.reply({ content: "⚠️ Something went wrong removing the sticky message.", ephemeral: true });
    }

    return interaction.reply({
      content: removed ? "✅ Sticky message removed from this channel." : "There's no sticky message in this channel.",
      ephemeral: true
    });
  }
};

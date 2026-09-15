const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { isStaff } = require("../utils");
const { sendReactionRolePanel } = require("../reactionRoles");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("react-panel")
    .setDescription("Send the reaction-role ping panel")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Channel to send it in (defaults to this channel)").addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const target = interaction.options.getChannel("channel") || interaction.channel;
    await sendReactionRolePanel(target);
    return interaction.reply({ content: `✅ Reaction-role panel sent in ${target}.`, ephemeral: true });
  }
};

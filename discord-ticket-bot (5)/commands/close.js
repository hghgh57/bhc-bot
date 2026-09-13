const {
  SlashCommandBuilder, ModalBuilder, ActionRowBuilder,
  TextInputBuilder, TextInputStyle, PermissionsBitField
} = require("discord.js");
const { isStaff } = require("../utils");
const config = require("../config");
const { getClaim } = require("../ticketClaims");

// Runs the exact same "no permission" / claim-lock checks as the Close
// button in index.js, then shows the same "close_reason" modal — index.js's
// existing modal-submit handler does the actual closing either way.
module.exports = {
  data: new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket"),

  async execute(interaction) {
    const channel = interaction.channel;

    // Must be a ticket channel this bot actually created — every ticket
    // gets its opener's user ID set as the channel topic (same check /ticket-rename uses).
    const inTicketCategory = channel.parentId && Object.values(config.categories).includes(channel.parentId);
    const isOurTicket = inTicketCategory && /^\d{15,25}$/.test(channel.topic || "");
    if (!isOurTicket) {
      return interaction.reply({ content: "This isn't a ticket channel.", ephemeral: true });
    }

    const claimerId = getClaim(channel.id);
    const openerId = channel.topic;
    const hasBypass = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
      || interaction.member.roles.cache.has(config.bypassRole);

    if (claimerId) {
      // Already claimed — locked down to the claimer, the ticket owner, or bypass role only.
      const allowed = hasBypass || interaction.user.id === claimerId || interaction.user.id === openerId;
      if (!allowed) {
        return interaction.reply({ content: "This ticket has been claimed — only the claimer, the ticket owner, or bypass role can do that now.", ephemeral: true });
      }
    } else if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const modal = new ModalBuilder().setCustomId("close_reason").setTitle("Close Ticket");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder("Why is this ticket being closed?")
    ));
    return interaction.showModal(modal);
  }
};

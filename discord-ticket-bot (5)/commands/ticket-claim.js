const {
  SlashCommandBuilder, PermissionsBitField, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");
const config = require("../config");
const { isStaff } = require("../utils");
const { getClaim, setClaim } = require("../ticketClaims");
const { logTicketEvent } = require("../tickets");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket-claim")
    .setDescription("Claim the current ticket"),

  async execute(interaction) {
    const channel = interaction.channel;

    const inTicketCategory = channel.parentId && Object.values(config.categories).includes(channel.parentId);
    const isOurTicket = inTicketCategory && /^\d{15,25}$/.test(channel.topic || "");
    if (!isOurTicket) {
      return interaction.reply({ content: "This isn't a ticket channel.", ephemeral: true });
    }

    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    const existingClaimerId = getClaim(channel.id);
    if (existingClaimerId) {
      return interaction.reply({ content: `❌ This ticket has already been claimed by <@${existingClaimerId}>.`, ephemeral: true });
    }

    // Same permission rewrite the Claim button does — locks SendMessages
    // down to the claimer, the ticket opener, and the bypass role, while
    // staff keep read-only access.
    await channel.permissionOverwrites.set([
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
      { id: channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ]);

    setClaim(channel.id, interaction.user.id);

    // Best-effort: find the ticket's original claim/close card and update
    // it to match (footer + swap Claim -> Unclaim), same as the button does.
    try {
      const recent = await channel.messages.fetch({ limit: 50 });
      const card = recent.find(m =>
        m.author.id === interaction.client.user.id
        && m.components[0]?.components.some(c => ["claim", "unclaim", "close"].includes(c.customId))
      );
      if (card && card.embeds[0]) {
        const e = EmbedBuilder.from(card.embeds[0]).setFooter({ text: `Claimed by ${interaction.user.tag}` });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("unclaim").setLabel("Unclaim").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
        );
        await card.edit({ embeds: [e], components: [row] });
      }
    } catch {
      // Card not found or couldn't be edited — the claim itself already
      // went through, so this is just cosmetic and safe to skip.
    }

    await logTicketEvent(interaction.guild, `🤝 Ticket **#${channel.name}** claimed by ${interaction.user}`);
    return interaction.reply({ content: `Claimed by ${interaction.user}` });
  }
};

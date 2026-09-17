const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField,
  ActionRowBuilder, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, Collection,
  AttachmentBuilder, ActivityType
} = require("discord.js");
const config = require("./config");
const { isStaff } = require("./utils");
const { tickets, calculateTotal, sendTicketPanel, logTicketEvent, buildTranscript } = require("./tickets");
const { sendWelcomeMessage } = require("./welcome");
const {
  APPLICATION_TYPES, sessions,
  startApplication, cancelApplication, submitAnswer, sendApplicationPanel
} = require("./applications");
const { recordDeletedMessage, clearSnipe, getSnipe, buildSnipeEmbed } = require("./snipe");
const { handleMessageForSticky } = require("./sticky");
const { setAfk, clearAfk, getAfk } = require("./afk");

// Reaction roles: /react-panel and the messageReactionAdd/Remove listeners below.
const { isReactionRolePanel, findRoleForEmoji } = require("./reactionRoles");

// channelId -> claimer's user id. Lives in ./ticketClaims (not a local Map
// here) so commands/close.js can read the same claim lock the buttons use.
const { getClaim, setClaim, deleteClaim } = require("./ticketClaims");

// Giveaways: /gcreate, /greroll, and the Join/Leave buttons.
const { initGiveaways, joinGiveaway, leaveGiveaway } = require("./giveawayManager");

// Invite tracking: powers /gcreate's invite_entries bonus-entries option.
const { cacheGuildInvites, handleMemberJoin } = require("./inviteTracker");


// A ticket channel this bot actually created always has its opener's user
// ID set as the channel topic (same check /close and /ticket-rename use).
function isTicketChannel(channel) {
  const inTicketCategory = channel.parentId && Object.values(config.categories).includes(channel.parentId);
  return inTicketCategory && /^\d{15,25}$/.test(channel.topic || "");
}

// Shared by the normal Close button/modal flow AND ,requestclose's Accept
// button — builds/sends the transcript, DMs the opener, logs it, and
// deletes the channel. Everything else (the initial ack, permission
// checks) is handled by whichever flow calls this.
async function performTicketClose(guild, channel, closedByUser, reason) {
  deleteClaim(channel.id);

  try {
    const { content, filename } = await buildTranscript(channel, reason);

    const openerId = channel.topic;
    const opener = await client.users.fetch(openerId).catch(() => null);
    if (opener) {
      await opener.send({
        content: `📄 Here's the transcript for your ticket **#${channel.name}**.`,
        files: [new AttachmentBuilder(Buffer.from(content, "utf-8"), { name: filename })]
      }).catch(() => {});
    }

    await logTicketEvent(
      guild,
      `🔒 Ticket **#${channel.name}** closed by ${closedByUser}${reason ? `\n**Reason:** ${reason}` : ""}`,
      "#F04747",
      [new AttachmentBuilder(Buffer.from(content, "utf-8"), { name: filename })]
    );
  } catch (err) {
    console.error(`Failed to build/send transcript for #${channel.name}:`, err);
    await logTicketEvent(guild, `🔒 Ticket **#${channel.name}** closed by ${closedByUser}${reason ? `\n**Reason:** ${reason}` : ""} (⚠️ transcript failed — check logs)`, "#F04747");
  }

  setTimeout(() => channel.delete().catch(() => {}), 3000);
}

// Role allowed to use ,requestclose.
const REQUEST_CLOSE_ROLE_ID = "REQUEST_CLOSE_ROLE_ID";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions, // needed for reaction roles (/react-panel)
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

// =====================================================================
// CRASH GUARDS
// discord.js emits an "error" event on the client for things like a
// modal shown on an interaction that already expired (10062 Unknown
// interaction) or a reply sent twice (40060 already acknowledged) —
// totally normal, everyday timing hiccups, NOT bugs worth taking the
// whole bot down for. With no listener attached, Node's default
// behaviour for an unhandled "error" event is to crash the process,
// which is what was killing ,close: one bad interaction
// anywhere would kill the entire bot mid-command. These two listeners
// just log the error instead of crashing, so one flaky interaction
// can't take every other command down with it.
client.on("error", err => console.error("Discord client error:", err));
process.on("unhandledRejection", err => console.error("Unhandled rejection:", err));

// =====================================================================
// COMMAND LOADER
// Drop a new file in ./commands (exporting { data, execute }) and it's
// picked up automatically — no need to touch this file. Remember to run
// `node deploy-commands.js` afterwards so Discord knows about it.
// =====================================================================
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data || !command?.execute) {
    console.warn(`⚠️  Skipping ${file} — missing "data" or "execute" export.`);
    continue;
  }
  client.commands.set(command.data.name, command);
}

// =====================================================================
// READY
// =====================================================================
client.once("ready", () => {
  console.log(`Ready — loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(", ")}`);
  console.log("Note: slash commands are registered via `node deploy-commands.js`, not on startup.");
  client.user.setActivity("BHC37's Server", { type: ActivityType.Watching });

  initGiveaways(client).catch(err => console.error("Failed to initialize giveaways:", err));

  // Snapshot current invite use-counts for every guild so the very next
  // join in each one can be compared against a baseline. Requires the bot
  // to have "Manage Server" in that guild — logs a warning per-guild if not.
  for (const guild of client.guilds.cache.values()) {
    cacheGuildInvites(guild).catch(err => console.error(`Failed to cache invites for guild ${guild.id}:`, err));
  }
});

// =====================================================================
// INTERACTIONS
// =====================================================================
client.on("interactionCreate", async i => {
  // ---- Slash commands ----
  if (i.isChatInputCommand()) {
    const command = client.commands.get(i.commandName);
    if (!command) return;
    try {
      await command.execute(i);
    } catch (err) {
      console.error(`Error running /${i.commandName}:`, err);
      const payload = { content: "❌ Something went wrong running that command.", ephemeral: true };
      if (i.replied || i.deferred) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
    return;
  }

  // ---- Giveaway join / leave ----
  if (i.isButton() && (i.customId.startsWith("giveaway_join_") || i.customId.startsWith("giveaway_leave_"))) {
    const isLeave = i.customId.startsWith("giveaway_leave_");
    const prefix = isLeave ? "giveaway_leave_" : "giveaway_join_";
    const giveawayId = i.customId.slice(prefix.length);

    if (!giveawayId) {
      return i.reply({ content: "❌ Invalid giveaway.", ephemeral: true });
    }

    try {
      if (isLeave) await leaveGiveaway(i, giveawayId);
      else await joinGiveaway(i, giveawayId);
    } catch (err) {
      console.error("Giveaway button error:", err);
      const payload = { content: "❌ Something went wrong with that button.", ephemeral: true };
      if (i.replied || i.deferred) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
    return;
  }

  // ---- Ticket select menu ----
  if (i.isStringSelectMenu() && i.customId === "ticket") {
    const t = i.values[0], v = tickets[t];
    const modal = new ModalBuilder().setCustomId("m_" + t).setTitle(v.label);
    v.questions.forEach((q, n) => {
      const input = new TextInputBuilder().setCustomId("q" + n).setLabel(q.label).setStyle(q.style).setRequired(true);
      if (q.placeholder) input.setPlaceholder(q.placeholder);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    await i.showModal(modal);
    // Re-send the panel's own components so the dropdown's selection
    // highlight clears — otherwise Discord shows a checkmark on the last
    // picked option and won't let you pick it again until it refreshes.
    await i.message.edit({ components: i.message.components }).catch(() => {});
    return;
  }

  // ---- Ticket modal submit ----
  if (i.isModalSubmit() && i.customId.startsWith("m_")) {
    const t = i.customId.slice(2), v = tickets[t];
    try {
      const c = await i.guild.channels.create({
        name: `${t}-${i.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: config.categories[t],
        topic: i.user.id,
        permissionOverwrites: [
          { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });

      const answers = v.questions.map((q, n) => i.fields.getTextInputValue("q" + n) || "N/A");

      const emb = new EmbedBuilder().setColor("#8B5CF6").setTitle(`${v.emoji} ${v.label}`)
        .addFields(v.questions.map((q, n) => ({ name: q.label, value: answers[n] })))
        .setFooter({ text: "Open Ticket" });

      // Buy/Sell tickets: "How many?" x "How much per?" -> "Total: 144m"
      if (v.calc) {
        const total = calculateTotal(answers[0], answers[1]);
        emb.addFields({ name: "Total", value: total !== null ? `**${total}**` : "⚠️ Couldn't calculate a total from those numbers — a staff member will work it out manually." });
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await c.send({ content: `${i.user} <@&${config.staffRole}>`, embeds: [emb], components: [row] });
      await logTicketEvent(i.guild, `🎫 **${v.label}** ticket opened by ${i.user} — ${c}`);
      return i.reply({ content: `Created: ${c}`, ephemeral: true });
    } catch (err) {
      console.error(`Failed to create "${t}" ticket for ${i.user.tag} (${i.user.id}):`, err);
      return i.reply({
        content: "❌ Couldn't create your ticket — the category ID or role ID in config.js for this ticket type is probably missing or invalid. A server admin should check the bot's logs.",
        ephemeral: true
      });
    }
  }

  // ---- Application type select menu ----
  if (i.isStringSelectMenu() && i.customId === "apply_type") {
    const type = i.values[0];
    if (sessions.has(i.user.id)) {
      return i.reply({ content: "You already have an application in progress in your DMs.", ephemeral: true });
    }
    const info = APPLICATION_TYPES[type];
    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("Are you sure you want to apply?")
      .setDescription(
        `**${info.label}**\n\n` +
        "Once you start the application I will send you a series of questions. " +
        "You will have 3 hours to complete the application. If you do not complete the application in time, you will have to restart. " +
        "If you wish to stop the application feel free to click the cancel button at any time."
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`app_start_${type}`).setLabel("Start Application").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("app_cancel").setLabel("Cancel Application").setEmoji("🛑").setStyle(ButtonStyle.Danger)
    );
    try {
      await i.user.send({ embeds: [embed], components: [row] });
      return i.reply({ content: "📩 Check your DMs!", ephemeral: true });
    } catch {
      return i.reply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again.", ephemeral: true });
    }
  }

  // ---- Ticket claim/close/unclaim buttons ----
  if (i.isButton() && (i.customId === "claim" || i.customId === "close" || i.customId === "unclaim")) {
    const claimerId = getClaim(i.channelId);
    const hasBypass = i.member.permissions.has(PermissionsBitField.Flags.Administrator) || i.member.roles.cache.has(config.bypassRole);

    if (i.customId === "unclaim") {
      // Only the claimer or bypass role can give up a claim (not the opener).
      const allowed = hasBypass || i.user.id === claimerId;
      if (!allowed) return i.reply({ content: "Only the claimer or bypass role can unclaim this.", ephemeral: true });
    } else if (!isStaff(i.member)) {
      return i.reply({ content: "No permission.", ephemeral: true });
    }

    if (i.customId == "claim") {
      await i.channel.permissionOverwrites.set([
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] },
        { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]);
      setClaim(i.channelId, i.user.id);
      const e = EmbedBuilder.from(i.message.embeds[0]).setFooter({ text: `Claimed by ${i.user.tag}` });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("unclaim").setLabel("Unclaim").setEmoji("🔓").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await i.update({ embeds: [e], components: [row] });
      await logTicketEvent(i.guild, `🤝 Ticket **#${i.channel.name}** claimed by ${i.user}`);
      return i.followUp({ content: `Claimed by ${i.user}`, ephemeral: false });
    }
    if (i.customId == "unclaim") {
      const overwrites = [
        { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: config.staffRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: i.channel.topic, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: config.bypassRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ];
      await i.channel.permissionOverwrites.set(overwrites);
      deleteClaim(i.channelId);
      const e = EmbedBuilder.from(i.message.embeds[0]).setFooter({ text: "Open Ticket" });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🤝").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );
      await i.update({ embeds: [e], components: [row] });
      await logTicketEvent(i.guild, `🔓 Ticket **#${i.channel.name}** unclaimed by ${i.user}`);
      return i.followUp({ content: `Unclaimed by ${i.user}`, ephemeral: false });
    }
    if (i.customId == "close") {
      // Ask for an optional reason before actually closing.
      const modal = new ModalBuilder().setCustomId("close_reason").setTitle("Close Ticket");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder("Why is this ticket being closed?")
      ));
      return i.showModal(modal);
    }
    return;
  }

  // ---- Close ticket modal submit ----
  if (i.isModalSubmit() && i.customId === "close_reason") {
    const reason = i.fields.getTextInputValue("reason")?.trim();
    await i.reply({ content: "Closing in 3 seconds..." });
    await performTicketClose(i.guild, i.channel, i.user, reason);
    return;
  }

  // ---- ,requestclose Accept/Deny buttons ----
  if (i.isButton() && (i.customId.startsWith("reqclose_accept_") || i.customId.startsWith("reqclose_deny_"))) {
    const openerId = i.channel.topic;
    if (i.user.id !== openerId) {
      return i.reply({ content: "This isn't for you — only the person who opened this ticket can respond.", ephemeral: true });
    }

    const accepted = i.customId.startsWith("reqclose_accept_");
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("reqclose_accept_done").setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId("reqclose_deny_done").setLabel("Deny").setEmoji("❌").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    if (!accepted) {
      await i.update({ components: [disabledRow] });
      return i.followUp({ content: `${i.user} denied the request to close this ticket.` });
    }

    await i.update({ components: [disabledRow] });
    await i.followUp({ content: `${i.user} agreed — closing in 3 seconds...` });
    await performTicketClose(i.guild, i.channel, i.user, null);
    return;
  }

  // ---- Application: Start button ----
  if (i.isButton() && i.customId.startsWith("app_start_")) {
    const type = i.customId.slice("app_start_".length);
    if (!APPLICATION_TYPES[type]) return;
    if (sessions.has(i.user.id)) return i.reply({ content: "You already have an application in progress.", ephemeral: true });
    await i.update({ content: "✅ Application started! Answer each question below.", embeds: [], components: [] });
    return startApplication(i.user, type);
  }

  // ---- Application: Cancel button (works before or during an application) ----
  if (i.isButton() && i.customId === "app_cancel") {
    await i.update({ components: [] }).catch(() => {});
    return cancelApplication(i.user);
  }

  // ---- Application: dropdown answers ----
  if (i.isStringSelectMenu() && i.customId === "app_select") {
    const session = sessions.get(i.user.id);
    if (!session || session.awaiting !== "select") return i.reply({ content: "This application isn't active anymore.", ephemeral: true });
    const value = i.values[0];
    await i.update({ content: `Answer recorded: **${value}**`, embeds: [], components: [] });
    return submitAnswer(i.user, session, value);
  }

  // ---- Application: Quick Deny (no reason) ----
  if (i.isButton() && i.customId.startsWith("app_denyquick_")) {
    if (!isStaff(i.member)) return i.reply({ content: "No permission.", ephemeral: true });

    const rest = i.customId.slice("app_denyquick_".length);
    const firstUnderscore = rest.indexOf("_");
    const type = rest.slice(0, firstUnderscore);
    const applicantId = rest.slice(firstUnderscore + 1);
    const info = APPLICATION_TYPES[type];

    const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("#F04747").addFields({ name: "Status", value: `❌ Denied by ${i.user.tag}` });
    await i.update({ embeds: [embed, ...i.message.embeds.slice(1)], components: [] });

    const applicant = await client.users.fetch(applicantId).catch(() => null);
    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder().setColor("#F04747").setTitle(`❌ ${info.label} Denied`).setDescription(`Your ${info.label.toLowerCase()} has been **denied** by ${i.user.tag}.`)]
      }).catch(() => {});
    }
    return;
  }

  // ---- Application: Accept / Deny w/ Reason (in the review channel) ----
  if (i.isButton() && (i.customId.startsWith("app_accept_") || i.customId.startsWith("app_deny_"))) {
    if (!isStaff(i.member)) return i.reply({ content: "No permission.", ephemeral: true });

    const isAccept = i.customId.startsWith("app_accept_");
    const rest = i.customId.slice(isAccept ? "app_accept_".length : "app_deny_".length);
    const firstUnderscore = rest.indexOf("_");
    const type = rest.slice(0, firstUnderscore);
    const applicantId = rest.slice(firstUnderscore + 1);
    const info = APPLICATION_TYPES[type];

    if (isAccept) {
      const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("#43B581").addFields({ name: "Status", value: `✅ Accepted by ${i.user.tag}` });
      await i.update({ embeds: [embed, ...i.message.embeds.slice(1)], components: [] });

      const roleId = config.approvedRoles[type];
      if (roleId) {
        const member = await i.guild.members.fetch(applicantId).catch(() => null);
        if (member) await member.roles.add(roleId).catch(err => console.error(`Failed to add approved role to ${applicantId}:`, err));
      }

      const applicant = await client.users.fetch(applicantId).catch(() => null);
      if (applicant) {
        await applicant.send({
          embeds: [new EmbedBuilder().setColor("#43B581").setTitle(`✅ ${info.label} Accepted`).setDescription(`Congratulations! Your ${info.label.toLowerCase()} has been **accepted** by ${i.user.tag}.`)]
        }).catch(() => {});
      }
      return;
    }

    // Deny w/ Reason -> ask for a reason via modal
    const modal = new ModalBuilder().setCustomId(`app_deny_reason_${type}_${applicantId}`).setTitle("Deny Application");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("Reason for denial").setStyle(TextInputStyle.Paragraph).setRequired(true)
    ));
    return i.showModal(modal);
  }

  // ---- Deny reason modal submit ----
  if (i.isModalSubmit() && i.customId.startsWith("app_deny_reason_")) {
    const rest = i.customId.slice("app_deny_reason_".length);
    const firstUnderscore = rest.indexOf("_");
    const type = rest.slice(0, firstUnderscore);
    const applicantId = rest.slice(firstUnderscore + 1);
    const info = APPLICATION_TYPES[type];
    const reason = i.fields.getTextInputValue("reason");

    const embed = EmbedBuilder.from(i.message.embeds[0]).setColor("#F04747").addFields(
      { name: "Status", value: `❌ Denied by ${i.user.tag}` },
      { name: "Reason", value: reason }
    );
    await i.update({ embeds: [embed, ...i.message.embeds.slice(1)], components: [] });

    const applicant = await client.users.fetch(applicantId).catch(() => null);
    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder().setColor("#F04747").setTitle(`❌ ${info.label} Denied`).setDescription(`Your ${info.label.toLowerCase()} has been **denied** by ${i.user.tag}.`).addFields({ name: "Reason", value: reason })]
      }).catch(() => {});
    }
    return;
  }
});

// =====================================================================
// NEW MEMBER WELCOME
// =====================================================================
client.on("guildMemberAdd", member => {
  sendWelcomeMessage(member).catch(err => console.error("Failed to send welcome message:", err));
  handleMemberJoin(member).catch(err => console.error("Failed to process invite tracking for join:", err));
});

// =====================================================================
// REACTION ROLES — /react-panel
// Only acts on messages sendReactionRolePanel() actually sent (tracked in
// reactionRoles.js), so other reactions elsewhere in the server are left
// alone. Ignores the bot's own reactions and skips any entry whose
// roleId in config.js is still the placeholder text.
// =====================================================================
async function handleReactionRoleChange(reaction, user, add) {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    console.error("Failed to fetch partial reaction/message:", err);
    return;
  }

  if (!isReactionRolePanel(reaction.message.id)) return;

  const roleEntry = findRoleForEmoji(reaction.emoji);
  if (!roleEntry || !roleEntry.roleId || roleEntry.roleId.endsWith("_ID")) return;

  const guild = reaction.message.guild;
  if (!guild) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  try {
    if (add) {
      await member.roles.add(roleEntry.roleId);
      await user.send({ content: `✅ You now have the **${roleEntry.label}** role.` }).catch(() => {});
    } else {
      await member.roles.remove(roleEntry.roleId);
      await user.send({ content: `➖ Removed the **${roleEntry.label}** role.` }).catch(() => {});
    }
  } catch (err) {
    console.error(`Failed to ${add ? "add" : "remove"} reaction role ${roleEntry.roleId} for ${user.id}:`, err);
    // DM them so a missing-permission/role-hierarchy problem is visible
    // right away instead of only showing up in the bot's console logs.
    await user.send({
      content:
        `⚠️ I couldn't ${add ? "give" : "take away"} you the **${roleEntry.label}** role. ` +
        "This is almost always because my role in Server Settings → Roles needs to be moved " +
        "ABOVE that role, and/or I'm missing the \"Manage Roles\" permission — ask a staff member to check."
    }).catch(() => {});
  }
}

client.on("messageReactionAdd", (reaction, user) => {
  handleReactionRoleChange(reaction, user, true).catch(err => console.error("messageReactionAdd handler error:", err));
});

client.on("messageReactionRemove", (reaction, user) => {
  handleReactionRoleChange(reaction, user, false).catch(err => console.error("messageReactionRemove handler error:", err));
});

// =====================================================================
// SNIPE — remember the last deleted message per channel
// =====================================================================
client.on("messageDelete", message => {
  recordDeletedMessage(message);
});

// =====================================================================
// STICKY MESSAGES — repost the sticky to the bottom of the channel
// whenever someone else sends a message
// =====================================================================
client.on("messageCreate", message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  handleMessageForSticky(message).catch(err => console.error("Sticky repost failed:", err));
});

// =====================================================================
// ROASTS — used by ,roast @user
// =====================================================================
const ROASTS = [
  "You're the reason shampoo has instructions.",
  "You bring everyone together... to wonder what you're doing.",
  "You're not lazy, you're on energy-saving mode 24/7.",
  "If confidence was skill, you'd still be average.",
  "You're proof autocorrect can't fix everything.",
  "You have two brain cells and they're buffering.",
  "You'd lose a game of hide and seek because nobody would look.",
  "Your Wi-Fi has a stronger connection than your arguments.",
  "You're built like a loading screen.",
  "You make Mondays look exciting.",
  "You're the human version of 1% battery.",
  "If overthinking burned calories, you'd be ripped.",
  "You're about as useful as a chocolate teapot.",
  "You couldn't pour water out of a boot with instructions.",
  "You're always one step behind your own thoughts.",
  "Your luck is so bad, you'd trip over a cordless phone.",
  "You're the CEO of almost.",
  "You'd miss a free giveaway somehow.",
  "You're running on vibes and bad decisions.",
  "You're not a clown—you're the whole circus.",
  "You're the reason the mute button was invented.",
  "Your personality peaked in the tutorial.",
  "You talk a lot for someone who says nothing.",
  "You're built like an unfinished side quest.",
  "If stupidity burned calories, you'd disappear.",
  "You've got the confidence of a billionaire and the IQ of a potato.",
  "Every group chat has a weak link—you volunteered.",
  "You couldn't win an argument with autocorrect.",
  "You're proof that evolution takes breaks.",
  "You make NPCs look self-aware.",
  "You're the final boss of bad takes.",
  "Your barber deserves jail time.",
  "You're the only person who can lose a 1v0.",
  "Your ego writes checks your skills can't cash.",
  "You've got premium confidence on a free trial account.",
  "Your opinions should come with a skip button.",
  "You couldn't carry groceries, let alone a team.",
  "Your aim is so bad the walls feel safe.",
  "You're the human version of lag.",
  "Your best achievement is surviving this long.",
  "You're all keyboard, no gameplay.",
  "You make wrong decisions look consistent.",
  "You're the type to drown in shallow water.",
  "Your common sense is on permanent vacation.",
  "You got ratioed by reality.",
  "Your reflection rolls its eyes at you.",
  "You couldn't find a clue with Google Maps.",
  "You're built like expired DLC.",
  "You make disappointment look athletic.",
  "Even your excuses need better excuses.",
  "You're the reason \"low expectations\" exist.",
  "You're running on borrowed brain cells.",
  "Your chat history should be studied as a warning.",
  "You couldn't organize a two-piece puzzle.",
  "Your voice has negative FPS.",
  "You're allergic to good ideas.",
  "You're the Wi-Fi dead zone of conversations.",
  "Your luck is sponsored by failure.",
  "You make losing look professional.",
  "You're somehow loud and irrelevant.",
  "You couldn't hit water if you fell out of a boat.",
  "Your gameplay is legally considered target practice.",
  "You're the blueprint for bad timing.",
  "You couldn't spell victory if it autocorrected itself.",
  "Your decisions belong in a fail compilation.",
  "You're a plot twist nobody asked for.",
  "You make tutorials look difficult.",
  "You're the type to get lost in a straight hallway.",
  "Your strategy is just panic with confidence.",
  "You're a walking skill issue.",
  "You couldn't roast bread.",
  "Your comebacks arrive next week.",
  "You're built like an apology draft.",
  "You're the before picture in every ad.",
  "Your presence lowers team morale.",
  "You couldn't clutch with unlimited retries.",
  "You're speedrunning embarrassment.",
  "You're the reason spectators laugh.",
  "You've mastered the art of being wrong instantly.",
  "You couldn't lead ducks to a pond.",
  "Your flex is imaginary.",
  "You're the human loading icon.",
  "Your game sense is purely decorative.",
  "You couldn't outsmart a tutorial bot.",
  "You're permanently stuck in silver mindset.",
  "Your confidence has no parental supervision.",
  "You're built like a bug report.",
  "You're an expert at fumbling.",
  "You make friendly fire look intentional.",
  "You couldn't carry a backpack.",
  "Your predictions age like milk.",
  "You're the lag spike in everyone's day.",
  "Your brain files are corrupted.",
  "You couldn't finish a sentence without derailing it.",
  "Your highlight reel is buffering.",
  "You're the type to miss point-blank.",
  "Your teamwork is a horror genre.",
  "You're built like recycled excuses.",
  "You're the captain of bad decisions.",
  "Your logic needs customer support.",
  "You're somehow AFK while talking.",
  "You couldn't cook instant noodles.",
  "You're a participation trophy with Wi-Fi.",
  "Your memory resets every argument.",
  "You're the reason \"try again\" exists.",
  "Your luck owes you a refund.",
  "You're an unpaid actor in everyone else's story.",
  "You couldn't outplay a loading screen.",
  "You're the discount version of average.",
  "Your confidence is louder than your results.",
  "You couldn't catch a cold in winter.",
  "You're the typo in the group project.",
  "Your ideas arrive already outdated.",
  "You're built like an internet outage.",
  "You couldn't even gaslight Google.",
  "You're the side character who thinks he's the main event.",
  "Your talent is making simple things complicated.",
  "You're one update away from functioning.",
  "You're the reason \"skill gap\" is a phrase.",
  "You're living proof that talking and knowing aren't the same thing."
];

// userId -> timestamp (ms) they last successfully used ,roast
const roastCooldowns = new Map();
const ROAST_COOLDOWN_MS = 10_000;

// Only this user can use ,dm — everyone else is silently ignored (well,
// told "no permission") no matter what.
const DM_COMMAND_USER_ID = "DM_COMMAND_USER_ID";
const DM_COOLDOWN_MS = 60_000;
let dmLastUsed = 0; // only one user can ever use this command, so a single shared timestamp is enough

// =====================================================================
// AFK — clears the sender's AFK on any activity, and lets people know
// when they @mention someone who's currently AFK
// =====================================================================
client.on("messageCreate", message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // Sending any message (other than setting AFK again) clears your own AFK.
  if (!message.content.toLowerCase().startsWith(",afk")) {
    if (getAfk(message.author.id)) {
      clearAfk(message.author.id);
      message.reply({ content: `👋 Welcome back ${message.author}, I removed your AFK status.` }).catch(() => {});
    }
  }

  // Let the sender know if anyone they just mentioned is AFK.
  // Sent as an embed (not plain content) so the AFK user isn't pinged a second time.
  const mentioned = message.mentions.users.filter(u => !u.bot && u.id !== message.author.id);
  if (mentioned.size) {
    const lines = [];
    for (const user of mentioned.values()) {
      const afk = getAfk(user.id);
      if (afk) lines.push(`**${user.tag}** is AFK: ${afk.reason}`);
    }
    if (lines.length) {
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(`💤 ${lines.join("\n")}`);
      message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
    }
  }
});

// =====================================================================
// GUILD TEXT COMMANDS (,s / ,cs / ,roast / ,afk)
// =====================================================================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return; // guild-only commands
  if (!message.content.startsWith(",")) return;

  if (message.content.toLowerCase().startsWith(",afk")) {
    const reason = message.content.slice(",afk".length).trim() || "AFK";
    setAfk(message.author.id, reason);
    return message.reply({ content: `😴 You're now AFK: ${reason}` });
  }

  const [rawCmd] = message.content.slice(1).trim().split(/\s+/);
  const cmd = (rawCmd || "").toLowerCase();

  if (cmd === "s") {
    if (!isStaff(message.member)) return message.reply({ content: "No permission." });
    const snipe = getSnipe(message.channelId);
    if (!snipe) return message.reply({ content: "There's nothing to snipe in this channel." });
    return message.channel.send({ embeds: [buildSnipeEmbed(snipe)] });
  }

  if (cmd === "cs") {
    if (!isStaff(message.member)) return message.reply({ content: "No permission." });
    const cleared = clearSnipe(message.channelId);
    return message.reply({ content: cleared ? "🧹 Snipe cleared for this channel." : "There was nothing to clear." });
  }

  if (cmd === "roast") {
    const target = message.mentions.users.first();
    if (!target) return message.reply({ content: "Mention someone to roast! Usage: `,roast @user`" });

    const now = Date.now();
    const lastUsed = roastCooldowns.get(message.author.id);
    if (lastUsed && now - lastUsed < ROAST_COOLDOWN_MS) {
      const remaining = Math.ceil((ROAST_COOLDOWN_MS - (now - lastUsed)) / 1000);
      return message.reply({ content: `Woah, slow down — wait another ${remaining}s.` });
    }
    roastCooldowns.set(message.author.id, now);

    const roast = ROASTS[Math.floor(Math.random() * ROASTS.length)];
    return message.channel.send({ content: `${target} ${roast}` });
  }

  // ,dm @user <message> — locked to one specific user ID, full stop.
  if (cmd === "dm") {
    if (message.author.id !== DM_COMMAND_USER_ID) {
      return message.reply({ content: "No permission." });
    }

    const now = Date.now();
    const elapsed = now - dmLastUsed;
    if (elapsed < DM_COOLDOWN_MS) {
      const remaining = Math.ceil((DM_COOLDOWN_MS - elapsed) / 1000);
      return message.reply({ content: `⏳ Slow down — try again in ${remaining}s.` });
    }

    // Accept either an @mention or a raw user ID as the first argument.
    const args = message.content.slice(1).trim().split(/\s+/); // ["dm", "<target>", ...rest]
    const rawTarget = args[1];
    const mentioned = message.mentions.users.first();
    const idMatch = rawTarget && rawTarget.match(/^(?:<@!?(\d+)>|(\d{15,25}))$/);
    const targetId = mentioned?.id || (idMatch ? (idMatch[1] || idMatch[2]) : null);

    if (!targetId) {
      return message.reply({ content: "Usage: `,dm @user <message>` or `,dm <user id> <message>`" });
    }

    let target;
    try {
      target = await client.users.fetch(targetId);
    } catch {
      return message.reply({ content: `❌ Couldn't find a user with ID \`${targetId}\`.` });
    }

    // Strip the leading ",dm" and the target (mention OR raw ID, whichever
    // was used) out of the raw content — whatever's left is the message.
    const body = message.content
      .slice(message.content.indexOf("dm") + 2)
      .replace(/<@!?\d+>|\d{15,25}/, "")
      .trim();

    if (!body) {
      return message.reply({ content: "You need to actually include a message. Usage: `,dm @user <message>` or `,dm <user id> <message>`" });
    }

    try {
      await target.send({ content: body });
    } catch (err) {
      console.error(`,dm: failed to DM ${target.id}:`, err);
      return message.reply({ content: `❌ Couldn't DM ${target} — they may have DMs closed or have blocked the bot.` });
    }

    dmLastUsed = Date.now();
    return message.reply({ content: "Dm sent" });
  }

  // ,requestclose — only REQUEST_CLOSE_ROLE_ID, only inside a ticket
  // channel. Asks the ticket opener to agree via Accept/Deny buttons
  // instead of closing it outright.
  if (cmd === "requestclose") {
    if (!message.member.roles.cache.has(REQUEST_CLOSE_ROLE_ID)) {
      return message.reply({ content: "No permission." });
    }
    if (!isTicketChannel(message.channel)) {
      return message.reply({ content: "This isn't a ticket channel." });
    }

    const openerId = message.channel.topic;
    const embed = new EmbedBuilder()
      .setColor("#F1C40F")
      .setDescription(`<@${openerId}> ${message.author} has requested to close this ticket. Do you agree?`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("reqclose_accept_").setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("reqclose_deny_").setLabel("Deny").setEmoji("❌").setStyle(ButtonStyle.Secondary)
    );

    return message.channel.send({ content: `<@${openerId}>`, embeds: [embed], components: [row] });
  }
});

// =====================================================================
// DM MESSAGES (text / image answers for active applications)
// =====================================================================
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (message.guild) return; // DMs only

  const session = sessions.get(message.author.id);
  if (!session) return;

  const q = session.questions[session.index];

  if (session.awaiting === "text") {
    if (!message.content.trim()) return message.reply("Please send a text answer.");
    return submitAnswer(message.author, session, message.content.trim());
  }

  if (session.awaiting === "images") {
    const images = [...message.attachments.values()].filter(a => (a.contentType || "").startsWith("image/")).map(a => a.url);
    if (images.length < q.min || images.length > q.max) {
      return message.reply(`Please upload between ${q.min} and ${q.max} images in a single message.`);
    }
    return submitAnswer(message.author, session, images);
  }

  if (session.awaiting === "images_or_text") {
    const images = [...message.attachments.values()].filter(a => (a.contentType || "").startsWith("image/")).map(a => a.url);
    if (images.length) {
      if (images.length > q.max) return message.reply(`Please upload up to ${q.max} images.`);
      return submitAnswer(message.author, session, images);
    }
    if (!message.content.trim()) return message.reply("Please send a text answer, or upload images.");
    return submitAnswer(message.author, session, message.content.trim());
  }
  // if session.awaiting === "select", ignore plain messages — they must use the dropdown
});

client.login(config.token);

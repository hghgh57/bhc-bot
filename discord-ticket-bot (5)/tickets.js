const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, TextInputStyle } = require("discord.js");
const config = require("./config");

// =====================================================================
// TICKET SYSTEM
// Each ticket type has its own emoji, label, and modal questions.
// question.style: TextInputStyle.Short (one line) or .Paragraph (multi-line)
// question.placeholder is optional extra hint text shown in the empty field.
//
// `calc: true` on a ticket type means its first two questions are treated
// as a quantity and a price-per-unit — the ticket embed will automatically
// add a "Total" field of quantity x price, shown with an "m" suffix
// (e.g. 20 x 7.2 -> "144m"). See calculateTotal() below.
// =====================================================================
const tickets = {
  buying: {
    emoji: "🦴",
    label: "Buying Spawners",
    panelLabel: "Buying spawners",
    panelDesc: "Buy spawners from staff",
    calc: true,
    questions: [
      { label: "How many?", style: TextInputStyle.Short },
      { label: "How much per?", style: TextInputStyle.Short }
    ]
  },
  selling: {
    emoji: "🦴",
    label: "Sell Spawners",
    panelLabel: "Sell spawners",
    panelDesc: "Sell spawners to staff",
    calc: true,
    questions: [
      { label: "How many?", style: TextInputStyle.Short },
      { label: "How much per?", style: TextInputStyle.Short }
    ]
  },
  gamble: {
    emoji: "💵",
    label: "Missed Gamble",
    panelLabel: "Missed gamble",
    panelDesc: "Make this if BHC missed your gamble",
    questions: [
      { label: "What happened?", style: TextInputStyle.Paragraph },
      { label: "How much was missed?", style: TextInputStyle.Short },
      { label: "What is your IGN?", style: TextInputStyle.Short }
    ]
  },
  giveaway: {
    emoji: "💰",
    label: "Giveaway Sponsor/Claim",
    panelLabel: "Giveaway claim/sponsor",
    panelDesc: "Sponsor or claim a giveaway",
    questions: [
      { label: "How much did you win?", style: TextInputStyle.Short },
      { label: "What's your IGN?", style: TextInputStyle.Short },
      {
        label: "Can you provide an uncropped screenshot?",
        style: TextInputStyle.Short,
        placeholder: "Yes/No - attach it in the ticket once it's created"
      }
    ]
  },
  partnership: {
    emoji: "🤝",
    label: "Partnership",
    panelLabel: "Partnership",
    panelDesc: "Propose a partnership with our server",
    questions: [
      { label: "How many members does your server have?", style: TextInputStyle.Short },
      { label: "Can you send your ad straight away?", style: TextInputStyle.Short }
    ]
  }
};

// Multiplies the "How many?" answer by the "How much per?" answer for
// calc-enabled ticket types, and formats it with a trailing "m" (e.g.
// 20 and 7.2 -> "144m"). Returns null if either answer isn't a plain number.
function calculateTotal(qtyAnswer, priceAnswer) {
  const qty = parseFloat(qtyAnswer);
  const price = parseFloat(priceAnswer);
  if (!isFinite(qty) || !isFinite(price)) return null;

  const total = qty * price;
  if (!isFinite(total)) return null;

  // Round to 2 decimals so floating point noise (7.2 * 20 = 143.99999...)
  // doesn't leak into the displayed total.
  const rounded = Math.round(total * 100) / 100;
  return `${rounded}m`;
}

async function sendTicketPanel(channel) {
  const list = Object.values(tickets)
    .map(v => `**${v.panelLabel}**\n${v.panelDesc}`)
    .join("\n");

  const e = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("Tickets")
    .setDescription(`Below is a drop down menu to create support tickets and for market tickets. Make sure to read the Ticket rules above ^\n\n${list}`);
  const m = new StringSelectMenuBuilder().setCustomId("ticket").setPlaceholder("Select...")
    .addOptions(Object.entries(tickets).map(([k, v]) => ({ label: v.label, value: k, emoji: v.emoji, description: "Click on this option to create a ticket" })));
  await channel.send({ embeds: [e], components: [new ActionRowBuilder().addComponents(m)] });
}

async function logTicketEvent(guild, description, color = "#8B5CF6", files = []) {
  if (!config.ticketLogChannel) return;
  const channel = await guild.channels.fetch(config.ticketLogChannel).catch(() => null);
  if (!channel) return;
  const embed = new EmbedBuilder().setColor(color).setDescription(description).setTimestamp();
  await channel.send({ embeds: [embed], files }).catch(() => {});
}

// Fetches every message in a ticket channel (oldest -> newest) and builds
// a plain-text transcript. Returns { content, filename } so the caller can
// wrap it in as many AttachmentBuilder instances as it needs to send.
async function buildTranscript(channel, reason) {
  const messages = [];
  let before;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.reverse(); // oldest first

  const lines = messages.map(m => {
    const time = new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
    let line = `[${time}] ${m.author.tag}: ${m.content || ""}`;
    if (m.attachments.size) {
      line += ` [attachment(s): ${[...m.attachments.values()].map(a => a.url).join(", ")}]`;
    }
    if (m.embeds.length) {
      line += ` [${m.embeds.length} embed(s)]`;
    }
    return line;
  });

  const header = `Transcript for #${channel.name}\nGenerated: ${new Date().toISOString()}\n${reason ? `Close reason: ${reason}\n` : ""}${"=".repeat(60)}\n\n`;
  return { content: header + (lines.join("\n") || "(no messages)"), filename: `transcript-${channel.name}.txt` };
}

module.exports = { tickets, calculateTotal, sendTicketPanel, logTicketEvent, buildTranscript };

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle
} = require("discord.js");
const config = require("./config");

// question "type" values:
//   text          -> plain text answer, collected from a DM message
//   select        -> answer chosen from a dropdown
//   images        -> 2-5 image attachments required
//   images_or_text-> image attachments OR a text answer (used for optional vouches)
const STAFF_QUESTIONS = [
  { key: "ign", type: "text", label: "What's your IGN (Minecraft username)?" },
  { key: "balance", type: "text", label: "What's your in-game balance?" },
  { key: "why", type: "text", label: "Why do you want to be staff on Sac's Service?" },
  { key: "howlong", type: "text", label: "How long have you been in this server?" },
  { key: "activity", type: "text", label: "How active can you be each week?" },
  { key: "pastexp", type: "text", label: "Do you have past staff experience? If so list them." },
  { key: "arguments", type: "text", label: "How would you deal with arguments or drama in chat?" },
  { key: "rulebreak", type: "text", label: "How would you handle someone breaking our rules?" },
  { key: "improve", type: "text", label: "What would you do to help improve the server?" },
  { key: "sponsor", type: "select", label: "Will you sponsor giveaways?", options: ["Yes", "No", "Possibly"] },
  { key: "agree", type: "select", label: "Do you agree that if any bad detail or spelling it will be denied?", options: ["Yes", "No"] }
];

const BUILDER_QUESTIONS = [
  { key: "info", type: "text", label: "What's your IGN, Balance, Age and Playtime?" },
  { key: "types", type: "text", label: "What types of bases can you build? (Maparts, stash bases, regear rooms, underground bases, mega bases, etc.)" },
  { key: "images", type: "images", min: 2, max: 5, label: "Upload 2-5 images of past bases you have built (In Donut, not Creative)." },
  { key: "vouches", type: "images_or_text", max: 5, label: "Do you have any vouches or images to upload?" },
  { key: "schematic", type: "select", label: "Have you ever built using a schematic/Litematica before?", options: ["Yes", "No", "Sometimes"] },
  { key: "customdesigns", type: "text", label: "Can you build custom designs or only follow schematics?" },
  { key: "timeframe", type: "text", label: "How long would a medium-sized base usually take you to complete?" },
  { key: "confidential", type: "text", label: "Are you able to delete homes, remove evidence and keep builds confidential after finishing the job?" },
  { key: "payment", type: "text", label: "Do you understand that all payments go through the owner till the build is complete and you will get paid at the end of every week?" },
  { key: "better", type: "text", label: "Why are you a better builder than others? (2 sentences)" }
];

const APPLICATION_TYPES = {
  staff: { label: "Staff Application", emoji: "🛡️", questions: STAFF_QUESTIONS },
  builder: { label: "Builder Application", emoji: "🏗️", questions: BUILDER_QUESTIONS }
};

// userId -> session
const sessions = new Map();

function cancelButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("app_cancel").setLabel("Cancel Application").setEmoji("🛑").setStyle(ButtonStyle.Danger)
  );
}

function clearSession(userId) {
  const s = sessions.get(userId);
  if (s && s.timer) clearTimeout(s.timer);
  sessions.delete(userId);
}

async function sendQuestion(user, session) {
  const q = session.questions[session.index];
  session.awaiting = q.type;

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle(`${APPLICATION_TYPES[session.type].emoji} ${APPLICATION_TYPES[session.type].label} — Question ${session.index + 1}/${session.questions.length}`)
    .setDescription(q.label);

  if (q.type === "images") embed.setFooter({ text: `Upload ${q.min}-${q.max} images in a single message.` });
  if (q.type === "images_or_text") embed.setFooter({ text: "Reply with text, or upload images in a single message." });

  const components = [];
  if (q.type === "select") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("app_select")
      .setPlaceholder("Choose an answer...")
      .addOptions(q.options.map(o => ({ label: o, value: o })));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  components.push(cancelButtonRow());

  await user.send({ embeds: [embed], components }).catch(() => {});
}

async function startApplication(user, type) {
  if (sessions.has(user.id)) return;

  const questions = APPLICATION_TYPES[type].questions;
  const session = {
    type,
    questions,
    index: 0,
    answers: {},
    appId: `${type}-${user.id}-${Date.now()}`,
    awaiting: null,
    timer: setTimeout(() => expireApplication(user), config.applicationTimeLimitMs)
  };
  sessions.set(user.id, session);
  await sendQuestion(user, session);
}

async function expireApplication(user) {
  const session = sessions.get(user.id);
  if (!session) return;
  clearSession(user.id);
  const embed = new EmbedBuilder()
    .setColor("#F04747")
    .setTitle("⏰ Application Expired")
    .setDescription("You did not finish your application within the 3 hour time limit. Please start a new application if you'd still like to apply.");
  await user.send({ embeds: [embed] }).catch(() => {});
}

async function cancelApplication(user) {
  clearSession(user.id);
  const embed = new EmbedBuilder()
    .setColor("#F04747")
    .setTitle("🛑 Application Cancelled")
    .setDescription("Your application has been cancelled. You can start a new one at any time.");
  await user.send({ embeds: [embed] }).catch(() => {});
}

async function submitAnswer(user, session, value) {
  session.answers[session.questions[session.index].key] = value;
  session.index++;

  if (session.index >= session.questions.length) {
    clearTimeout(session.timer);
    sessions.delete(user.id);
    await finishApplication(user, session);
  } else {
    await sendQuestion(user, session);
  }
}

async function finishApplication(user, session) {
  await user.send({
    embeds: [new EmbedBuilder().setColor("#43B581").setTitle("✅ Application Submitted").setDescription("Thanks! Your application has been sent to the team for review. You'll receive a DM once it's been decided.")]
  }).catch(() => {});

  const client = user.client;
  const reviewChannel = await client.channels.fetch(config.applicationReviewChannels[session.type]).catch(() => null);
  if (!reviewChannel) return;

  const info = APPLICATION_TYPES[session.type];
  const galleryUrl = `https://application.local/${session.appId}`;

  const mainEmbed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setURL(galleryUrl)
    .setTitle(`${info.emoji} New ${info.label}`)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setFooter({ text: `User ID: ${user.id}` })
    .setTimestamp();

  const imageEmbeds = [];
  for (const q of session.questions) {
    const answer = session.answers[q.key];
    if (q.type === "images" || (q.type === "images_or_text" && Array.isArray(answer))) {
      const urls = answer || [];
      mainEmbed.addFields({ name: q.label, value: urls.length ? `${urls.length} image(s) attached below.` : "No images provided." });
      for (const url of urls) imageEmbeds.push(new EmbedBuilder().setURL(galleryUrl).setImage(url));
    } else {
      mainEmbed.addFields({ name: q.label, value: String(answer ?? "N/A").slice(0, 1024) });
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app_accept_${session.type}_${user.id}`).setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app_denyquick_${session.type}_${user.id}`).setLabel("Deny").setEmoji("❌").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`app_deny_${session.type}_${user.id}`).setLabel("Deny w/ Reason").setEmoji("📝").setStyle(ButtonStyle.Secondary)
  );

  const pingRole = config.applicationPingRoles[session.type];
  await reviewChannel.send({
    content: pingRole ? `<@&${pingRole}>` : undefined,
    embeds: [mainEmbed, ...imageEmbeds].slice(0, 10),
    components: [row]
  });
}

function buildApplicationPanelEmbed() {
  return new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("Staff & Builder Application")
    .setDescription(
      "Sacad is looking for reliable and suited applicants to become a part of the staff team, but before applying for Staff or Builder, please make sure you meet the requirements below:\n\n" +
      "👤 Must be 14+ years old\n" +
      "💬 Must be active in the server\n" +
      "🤝 Must be respectful to all members & staff\n" +
      "🧠 Must be mature and able to handle drama/problems\n" +
      "📖 Must know and follow all server rules\n" +
      "📝 Must put effort into your application (no 1 word answers)\n" +
      "💰 Must have money to buy/sell spawners if needed\n" +
      "🪦 Must know basic server stuff (selling/buying skeleton spawners, support, etc.)\n" +
      "🚫 Must not have recent punishments or warnings\n" +
      "📸 Must have screenshots of previous builds (builder only)\n" +
      "⚖️ Must not scam, grief, or abuse your power over others\n" +
      "🏗️ Must have experience building on DonutSMP (builders only)\n" +
      "⭐ Must provide vouches from previous customers (screenshots or usernames - builders only)\n" +
      "📐 Must know how to use schematics/Litematica if required (builders only)\n" +
      "🔒 Must keep customer bases confidential and delete homes when requested\n\n" +
      "**Further notice:**\n" +
      "❌ Asking for staff lowers your chances\n" +
      "📩 DMing staff to check your application may result in denial\n" +
      "🏆 Staff is chosen based on trust, activity, maturity & helpfulness\n" +
      "⛔ Not everyone will be accepted"
    );
}

async function sendApplicationPanel(channel) {
  const options = [];
  if (config.applicationsEnabled.staff) options.push({ label: "Staff Applications", value: "staff", emoji: "🛡️" });
  if (config.applicationsEnabled.builder) options.push({ label: "Builder Applications", value: "builder", emoji: "🏗️" });
  if (!options.length) return false;
  const menu = new StringSelectMenuBuilder().setCustomId("apply_type").setPlaceholder("Select an application type...").addOptions(options);
  await channel.send({ embeds: [buildApplicationPanelEmbed()], components: [new ActionRowBuilder().addComponents(menu)] });
  return true;
}

module.exports = {
  APPLICATION_TYPES,
  sessions,
  startApplication,
  cancelApplication,
  submitAnswer,
  sendApplicationPanel
};

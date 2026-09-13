const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");

// =====================================================================
// /rps — Rock Paper Scissors
//
// Flow:
//   1. Challenger picks an opponent. A challenge embed with
//      Accept/Decline buttons is posted (pings the opponent).
//   2. If accepted, both players get Rock/Paper/Scissors buttons on
//      the same message. Each pick is only confirmed to that player
//      (ephemeral reply) so nobody can see the other's choice.
//   3. Once both have picked (or 30s pass), the result is revealed by
//      editing the original message.
//
// Anti-raid: a 10s per-user cooldown on the command itself, so it
// can't be spammed to ping people over and over.
// =====================================================================

const COOLDOWN_MS = 10_000;
const cooldowns = new Map(); // userId -> timestamp they can next use /rps

const CHOICE_EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
const CHOICE_LABEL = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

// what beats what: key beats value
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };

function decideWinner(a, b) {
  if (a === b) return "draw";
  return BEATS[a] === b ? "a" : "b";
}

function challengeRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rps_accept").setLabel("Accept").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("rps_decline").setLabel("Decline").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function choiceRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rps_rock").setLabel("Rock").setEmoji("🪨").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("rps_paper").setLabel("Paper").setEmoji("📄").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("rps_scissors").setLabel("Scissors").setEmoji("✂️").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Challenge someone to rock paper scissors")
    .addUserOption(o => o.setName("opponent").setDescription("Who do you want to verse?").setRequired(true)),

  async execute(interaction) {
    const challenger = interaction.user;
    const opponent = interaction.options.getUser("opponent");

    // ---- cooldown (10s per user, anti-raid) ----
    const now = Date.now();
    const readyAt = cooldowns.get(challenger.id) ?? 0;
    if (now < readyAt) {
      const secsLeft = Math.ceil((readyAt - now) / 1000);
      return interaction.reply({
        content: `⏳ Slow down — you can use \`/rps\` again in ${secsLeft}s.`,
        ephemeral: true
      });
    }
    cooldowns.set(challenger.id, now + COOLDOWN_MS);

    // ---- validation ----
    if (opponent.id === challenger.id) {
      return interaction.reply({ content: "❌ You can't challenge yourself.", ephemeral: true });
    }
    if (opponent.bot) {
      return interaction.reply({ content: "❌ You can't challenge a bot.", ephemeral: true });
    }

    const challengeEmbed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("🪨📄✂️ Rock Paper Scissors")
      .setDescription(`${opponent}, ${challenger} has challenged you to a duel!\nDo you accept?`)
      .setFooter({ text: "This challenge expires in 30 seconds." });

    await interaction.reply({
      content: `${opponent}`,
      embeds: [challengeEmbed],
      components: [challengeRow()]
    });

    const message = await interaction.fetchReply();

    // ---- accept / decline ----
    let accepted;
    try {
      accepted = await message.awaitMessageComponent({
        filter: i => i.user.id === opponent.id && ["rps_accept", "rps_decline"].includes(i.customId),
        time: 30_000
      });
    } catch {
      const timeoutEmbed = EmbedBuilder.from(challengeEmbed)
        .setDescription(`${opponent} didn't respond in time. Challenge cancelled.`)
        .setFooter(null);
      return interaction.editReply({ embeds: [timeoutEmbed], components: [challengeRow(true)] });
    }

    if (accepted.customId === "rps_decline") {
      const declineEmbed = EmbedBuilder.from(challengeEmbed)
        .setDescription(`${opponent} declined the challenge from ${challenger}.`)
        .setFooter(null);
      return accepted.update({ embeds: [declineEmbed], components: [challengeRow(true)] });
    }

    const gameEmbed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("🪨📄✂️ Rock Paper Scissors")
      .setDescription(`${challenger} vs ${opponent}\nBoth players, pick your move below! (You won't see their pick.)`)
      .setFooter({ text: "30 seconds to choose." });

    await accepted.update({ embeds: [gameEmbed], components: [choiceRow()] });

    // ---- both players pick ----
    const picks = new Map(); // userId -> choice

    await new Promise(resolve => {
      const collector = message.createMessageComponentCollector({
        filter: i => [challenger.id, opponent.id].includes(i.user.id) &&
          ["rps_rock", "rps_paper", "rps_scissors"].includes(i.customId),
        time: 30_000
      });

      collector.on("collect", async i => {
        const choice = i.customId.slice("rps_".length);

        if (picks.has(i.user.id)) {
          return i.reply({ content: `You already picked **${CHOICE_LABEL[picks.get(i.user.id)]}**.`, ephemeral: true });
        }

        picks.set(i.user.id, choice);
        await i.reply({ content: `You picked ${CHOICE_EMOJI[choice]} **${CHOICE_LABEL[choice]}**.`, ephemeral: true });

        if (picks.size === 2) collector.stop("done");
      });

      collector.on("end", (_collected, reason) => resolve(reason));
    }).then(async reason => {
      const aChoice = picks.get(challenger.id);
      const bChoice = picks.get(opponent.id);

      if (!aChoice || !bChoice) {
        const missing = [];
        if (!aChoice) missing.push(challenger.toString());
        if (!bChoice) missing.push(opponent.toString());
        const abandonedEmbed = EmbedBuilder.from(gameEmbed)
          .setDescription(`${challenger} vs ${opponent}\n⌛ ${missing.join(" and ")} didn't pick in time. Game cancelled.`)
          .setFooter(null);
        return interaction.editReply({ embeds: [abandonedEmbed], components: [choiceRow(true)] });
      }

      const result = decideWinner(aChoice, bChoice);
      let resultLine;
      if (result === "draw") {
        resultLine = `🤝 It's a draw! Both picked ${CHOICE_EMOJI[aChoice]} **${CHOICE_LABEL[aChoice]}**.`;
      } else {
        const winner = result === "a" ? challenger : opponent;
        resultLine = `🏆 ${winner} wins!\n${challenger}: ${CHOICE_EMOJI[aChoice]} **${CHOICE_LABEL[aChoice]}**  vs  ${opponent}: ${CHOICE_EMOJI[bChoice]} **${CHOICE_LABEL[bChoice]}**`;
      }

      const resultEmbed = EmbedBuilder.from(gameEmbed)
        .setDescription(`${challenger} vs ${opponent}\n\n${resultLine}`)
        .setFooter(null);

      return interaction.editReply({ embeds: [resultEmbed], components: [choiceRow(true)] });
    });
  }
};

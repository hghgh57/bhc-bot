const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");

// =====================================================================
// /tictactoe — Tic Tac Toe
//
// Flow:
//   1. Challenger picks an opponent. A challenge embed with
//      Accept/Decline buttons is posted (pings the opponent).
//   2. If accepted, a 3x3 grid of buttons is shown. Challenger is ❌
//      and goes first, opponent is ⭕. Players alternate clicking
//      empty cells until there's a winner, a draw, or 60s of
//      inactivity pass.
//   3. The board is revealed/updated by editing the original message
//      after every move.
//
// Anti-raid: a 10s per-user cooldown on the command itself, so it
// can't be spammed to ping people over and over.
// =====================================================================

const COOLDOWN_MS = 10_000;
const cooldowns = new Map(); // userId -> timestamp they can next use /tictactoe

const MOVE_TIME_MS = 60_000;
const CHALLENGE_TIME_MS = 30_000;

const MARK = { X: "❌", O: "⭕" };
const EMPTY = "⬜";

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6]             // diagonals
];

function challengeRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ttt_accept").setLabel("Accept").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("ttt_decline").setLabel("Decline").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function boardRows(board, disabled = false) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cell = board[idx];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_cell_${idx}`)
          .setLabel(cell ? MARK[cell] : "⠀") // blank-ish label when the cell is empty
          .setStyle(cell === "X" ? ButtonStyle.Danger : cell === "O" ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(disabled || !!cell)
      );
    }
    rows.push(row);
  }
  return rows;
}

function renderBoardText(board) {
  let out = "";
  for (let r = 0; r < 3; r++) {
    const cells = [0, 1, 2].map(c => {
      const v = board[r * 3 + c];
      return v ? MARK[v] : EMPTY;
    });
    out += cells.join("") + "\n";
  }
  return out;
}

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every(cell => cell)) return "draw";
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tictactoe")
    .setDescription("Challenge someone to a game of tic tac toe")
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
        content: `⏳ Slow down — you can use \`/tictactoe\` again in ${secsLeft}s.`,
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
      .setTitle("⭕❌ Tic Tac Toe")
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
        filter: i => i.user.id === opponent.id && ["ttt_accept", "ttt_decline"].includes(i.customId),
        time: CHALLENGE_TIME_MS
      });
    } catch {
      const timeoutEmbed = EmbedBuilder.from(challengeEmbed)
        .setDescription(`${opponent} didn't respond in time. Challenge cancelled.`)
        .setFooter(null);
      return interaction.editReply({ embeds: [timeoutEmbed], components: [challengeRow(true)] });
    }

    if (accepted.customId === "ttt_decline") {
      const declineEmbed = EmbedBuilder.from(challengeEmbed)
        .setDescription(`${opponent} declined the challenge from ${challenger}.`)
        .setFooter(null);
      return accepted.update({ embeds: [declineEmbed], components: [challengeRow(true)] });
    }

    // ---- game state ----
    const board = Array(9).fill(null);
    let turn = challenger.id; // challenger is X and goes first
    const playerMark = { [challenger.id]: "X", [opponent.id]: "O" };

    function turnLine() {
      const current = turn === challenger.id ? challenger : opponent;
      return `${challenger} ${MARK.X}  vs  ${opponent} ${MARK.O}\n\n${renderBoardText(board)}\nIt's ${current}'s turn (${MARK[playerMark[turn]]}).`;
    }

    const gameEmbed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("⭕❌ Tic Tac Toe")
      .setDescription(turnLine())
      .setFooter({ text: "60 seconds per move." });

    await accepted.update({ embeds: [gameEmbed], components: boardRows(board) });

    // ---- play until win/draw/timeout ----
    await new Promise(resolve => {
      const collector = message.createMessageComponentCollector({
        filter: i => [challenger.id, opponent.id].includes(i.user.id) && i.customId.startsWith("ttt_cell_"),
        time: MOVE_TIME_MS
      });

      collector.on("collect", async i => {
        if (i.user.id !== turn) {
          return i.reply({ content: "⏳ It's not your turn.", ephemeral: true });
        }

        const idx = parseInt(i.customId.replace("ttt_cell_", ""), 10);
        if (board[idx]) {
          return i.reply({ content: "❌ That cell is already taken.", ephemeral: true });
        }

        board[idx] = playerMark[turn];

        const result = checkWinner(board);
        if (result) {
          collector.stop(result === "draw" ? "draw" : "win");
          return i.update({
            embeds: [EmbedBuilder.from(gameEmbed).setDescription(finalLine(result)).setFooter(null)],
            components: boardRows(board, true)
          });
        }

        // switch turns
        turn = turn === challenger.id ? opponent.id : challenger.id;

        // reset the inactivity timer for the next player's move
        collector.resetTimer({ time: MOVE_TIME_MS });

        return i.update({
          embeds: [EmbedBuilder.from(gameEmbed).setDescription(turnLine())],
          components: boardRows(board)
        });
      });

      function finalLine(result) {
        if (result === "draw") {
          return `${challenger} ${MARK.X}  vs  ${opponent} ${MARK.O}\n\n${renderBoardText(board)}\n🤝 It's a draw!`;
        }
        const winner = result === "X" ? challenger : opponent;
        return `${challenger} ${MARK.X}  vs  ${opponent} ${MARK.O}\n\n${renderBoardText(board)}\n🏆 ${winner} wins!`;
      }

      collector.on("end", async (_collected, reason) => {
        if (reason === "win" || reason === "draw") return resolve(reason);

        // timed out with no winner yet
        const current = turn === challenger.id ? challenger : opponent;
        const timeoutEmbed = EmbedBuilder.from(gameEmbed)
          .setDescription(`${challenger} ${MARK.X}  vs  ${opponent} ${MARK.O}\n\n${renderBoardText(board)}\n⌛ ${current} didn't move in time. Game cancelled.`)
          .setFooter(null);
        await interaction.editReply({ embeds: [timeoutEmbed], components: boardRows(board, true) });
        resolve("timeout");
      });
    });
  }
};

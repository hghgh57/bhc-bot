# Discord Ticket Bot

Features:
- Dropdown ticket panel (5 types), modal questions, per-category channels, claim/close, bypass role
  - 🦴 Buying Spawners / 🦴 Sell Spawners — asks "How many?" and "How much per?", then auto-calculates
    the total (qty x price) and shows it in the ticket embed with an "m" suffix, e.g. `20` and `7.2` -> **144m**
  - 💵 Missed Gamble
  - 💰 Giveaway Sponsor/Claim
  - 🤝 Partnership
- `/sticky` / `/unstick` — sticky message support
- Staff & Builder DM applications: dropdown panel -> confirm in DMs -> step-by-step Q&A (text, dropdown, and image-upload questions) -> auto-posts to a review channel with Accept/Deny (deny asks for a reason) -> DMs the applicant the result
- Applications auto-expire after 3 hours of inactivity and can be cancelled at any time
- Welcome messages, AFK (`,afk`), snipe (`,s` / `,cs`), channel lock (`,lock` / `,unlock`), `,purge`, `,roast`, `,dm`, `,requestclose`
- `/calculate`, `/embed`, `/membercount`, `/rps`, `/tictactoe`

## Project structure

```
config.js              - all IDs/env vars — fill in your own IDs before running
utils.js                - shared helpers (isStaff, isAdmin)
tickets.js               - ticket type definitions, buy/sell total calc, panel sender
applications.js          - application questions, session state, panel sender
commands/                - one file per slash command (data + execute)
deploy-commands.js       - registers commands from ./commands with Discord
index.js                 - loads commands, wires up all event handlers
```

## Setting up your ticket categories/roles

Everything in `config.js` is a placeholder string (e.g. `"STAFF_ROLE_ID"`, `"BUYING_CATEGORY_ID"`) —
open it and paste your real category/role/channel IDs in. To get an ID: enable Developer Mode
(User Settings -> Advanced), then right-click the channel/category/role -> Copy ID.

You'll need to create (and set the ID for) one category per ticket type in `config.categories`:
`buying`, `selling`, `gamble`, `giveaway`, `partnership`.

### Adding a new slash command

1. Create a new file in `commands/`, e.g. `commands/my-command.js`:

   ```js
   const { SlashCommandBuilder } = require("discord.js");

   module.exports = {
     data: new SlashCommandBuilder()
       .setName("my-command")
       .setDescription("What it does"),

     async execute(interaction) {
       await interaction.reply("Hello!");
     }
   };
   ```

2. Run `npm run deploy` (or `node deploy-commands.js`) to register it with Discord.
3. Restart the bot (`npm start`) so it picks up the new file.

You do NOT need to edit `index.js` — it automatically loads every file in `commands/`.

## Discord Developer Portal setup

1. Go to https://discord.com/developers/applications -> your app -> **Bot**.
2. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent** (needed for the welcome message / member count)
   - **Message Content Intent** (needed so the bot can read the answers people type in DMs and `,`-prefixed commands)
3. Under **OAuth2 -> URL Generator**, scope `bot` + `applications.commands`, permissions: Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History. Use the generated URL to invite the bot.
4. Make sure the bot's role sits above `bypassRole` where needed and above nothing it doesn't need to manage.
5. Users applying must have "Allow DMs from server members" enabled for this server, or the bot can't message them.

## Slash commands

- `/ticket-panel [channel]` — posts the market/support ticket panel (defaults to the current channel). Staff/bypass-role only.
- `/application-panel [channel]` — posts the Staff & Builder application panel (defaults to the current channel). Staff/bypass-role only.
- `/ticket-claim` — claims the current ticket. Staff/bypass-role only.
- `/ticket-add user:<@user>` — adds someone to the current ticket (view + chat only). Staff/bypass-role only.
- `/ticket-rename name:<new-name>` — renames the ticket channel you run it in. Staff/bypass-role only, and only works inside an actual ticket channel.
- `/close` — closes the current ticket (asks for an optional reason).
- `/sticky message:<text>` / `/unstick` — set/remove a sticky message in the current channel. Staff/bypass-role only.
- `/calculate expression:<...>` — a simple calculator, e.g. `5 + 3 * 2`.
- `/embed description:<...> [title] [colour] [plaintext]` — send a quick embed or plain-text message. Staff/bypass-role only.
- `/membercount` — shows the server's member/boost counts.
- `/rps` / `/tictactoe` — challenge another member to a game.

"Staff/bypass-role only" means Administrator, or whoever has the role in `bypassRole`/`staffRole` in `config.js`.

### Registering commands

Commands are **not registered automatically on startup**. Run the deploy script whenever you add, remove, or edit a command:

```
node deploy-commands.js            # registers to GUILD_ID — instant
node deploy-commands.js --global   # registers globally — can take up to an hour to show up
```

or with npm:

```
npm run deploy
npm run deploy:global
```

## Environment variables (Railway)

Deploy on Railway as a normal Node project (it auto-detects `package.json` and runs `npm install && npm start`). Set these in Project -> Variables:

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Your bot token (Developer Portal -> Bot -> Reset Token) — never commit this to `config.js` |
| `CLIENT_ID` | Your application/client ID — required by `deploy-commands.js` to register slash commands |
| `GUILD_ID` | Your server ID |

Everything else (channel IDs, category IDs, role IDs) isn't sensitive, so it's just hardcoded directly in `config.js` — open it and paste your real IDs in place of the placeholder strings.

## Local run

```
npm install
node deploy-commands.js
node index.js
```

For local testing, either set `BOT_TOKEN`/`CLIENT_ID`/`GUILD_ID` as environment variables, or temporarily hardcode them in `config.js` — just don't commit real tokens.

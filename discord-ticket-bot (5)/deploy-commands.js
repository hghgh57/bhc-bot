// Standalone script to register/update slash commands.
// Run this whenever you add, remove, or change a command in ./commands.
//
//   node deploy-commands.js            -> registers to GUILD_ID (instant, recommended for dev)
//   node deploy-commands.js --global   -> registers globally (can take up to 1 hour to propagate)

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");
const config = require("./config");

const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data || !command?.execute) {
    console.warn(`⚠️  Skipping ${file} — missing "data" or "execute" export.`);
    continue;
  }
  commands.push(command.data.toJSON());
  console.log(`Loaded command: ${command.data.name}`);
}

const rest = new REST().setToken(config.token);
const useGlobal = process.argv.includes("--global");

(async () => {
  try {
    console.log(`Deploying ${commands.length} slash command(s) ${useGlobal ? "globally" : `to guild ${config.guildId}`}...`);

    const route = useGlobal || !config.guildId
      ? Routes.applicationCommands(config.clientId)
      : Routes.applicationGuildCommands(config.clientId, config.guildId);

    const data = await rest.put(route, { body: commands });

    console.log(`✅ Successfully registered ${data.length} slash command(s).`);
  } catch (err) {
    console.error("Failed to deploy commands:", err);
  }
})();

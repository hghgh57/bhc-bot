const fs = require("fs");
const path = require("path");

// JSON-file-backed, same pattern as stats.js/tracker.js — this needs to
// survive a restart. Without it, if the bot restarts between ,lock and
// ,unlock, the snapshot of "what SendMessages looked like before" is lost,
// and ,unlock falls back to only clearing @everyone — leaving any other
// overwrite (staff role, ticket-opener overwrite, etc.) stuck denied.
const DATA_FILE = path.join(__dirname, "data", "locks.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save locks.json:", err);
  }
}

const data = load(); // channelId -> snapshot array

function getLockSnapshot(channelId) {
  return data[channelId];
}

function setLockSnapshot(channelId, snapshot) {
  data[channelId] = snapshot;
  save();
}

function deleteLockSnapshot(channelId) {
  delete data[channelId];
  save();
}

module.exports = { getLockSnapshot, setLockSnapshot, deleteLockSnapshot };

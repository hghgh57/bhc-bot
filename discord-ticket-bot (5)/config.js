module.exports = {
  // ==== From Railway (or your host's) environment variables ====
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID, // used by deploy-commands.js to register slash commands
  guildId: process.env.GUILD_ID,

  // ==== Everything else — paste your real IDs in below ====
  panelChannel: "PANEL_CHANNEL_ID", // where /ticket-panel posts by default

  bypassRole: "BYPASS_ROLE_ID", // can always type in a ticket even after it's been claimed by someone else
  staffRole: "STAFF_ROLE_ID",   // gets pinged + can see every new ticket as soon as it's created
  ticketLogChannel: "", // where ticket opened/claimed/closed events get logged. Leave as "" to disable logging.

  // One category per ticket type in tickets.js — the ticket channel gets
  // created under the matching category here.
  categories: {
    buying: "BUYING_CATEGORY_ID",
    selling: "SELLING_CATEGORY_ID",
    gamble: "GAMBLE_CATEGORY_ID",
    giveaway: "GIVEAWAY_CATEGORY_ID",
    partnership: "PARTNERSHIP_CATEGORY_ID"
  },

  // Roles exempt from ,s (snipe) — if someone with one of these roles
  // deletes a message, ,s will not be able to show it.
  snipeBypassRoles: [],

  // Only members with this role (or Administrator) can use ,lock / ,unlock
  lockRole: "LOCK_ROLE_ID",

  // Staff/Builder applications
  applicationPanelChannel: "APPLICATION_PANEL_CHANNEL_ID", // where the panel with the dropdown is posted
  applicationReviewChannels: {
    staff: "STAFF_REVIEW_CHANNEL_ID",     // finished staff applications get posted here for Accept/Deny
    builder: "BUILDER_REVIEW_CHANNEL_ID"  // finished builder applications get posted here for Accept/Deny
  },
  applicationTimeLimitMs: 3 * 60 * 60 * 1000, // 3 hours
  applicationsEnabled: {
    staff: true,
    builder: true
  },
  // Role given automatically when an application is accepted
  approvedRoles: {
    staff: "STAFF_APPROVED_ROLE_ID",
    builder: "BUILDER_APPROVED_ROLE_ID"
  },
  // Role pinged in the review channel when a new application comes in
  applicationPingRoles: {
    staff: "STAFF_PING_ROLE_ID",
    builder: "BUILDER_PING_ROLE_ID"
  },

  // Welcome messages (sent when a new member joins)
  welcome: {
    channel: "WELCOME_CHANNEL_ID", // channel where the welcome message gets posted
    description: "Welcome! Feel free to make yourself at home."
  }
};

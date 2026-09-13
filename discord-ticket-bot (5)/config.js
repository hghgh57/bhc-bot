module.exports = {
  // ==== From Railway (or your host's) environment variables ====
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID, // used by deploy-commands.js to register slash commands
  guildId: process.env.GUILD_ID,

  // ==== Everything else — paste your real IDs in below ====
  panelChannel: "", // where /ticket-panel posts by default

  bypassRole: "1548647934525055096", // can always type in a ticket even after it's been claimed by someone else
  staffRole: "1510924042469900318",   // gets pinged + can see every new ticket as soon as it's created
  ticketLogChannel: "", // where ticket opened/claimed/closed events get logged. Leave as "" to disable logging.

  // One category per ticket type in tickets.js — the ticket channel gets
  // created under the matching category here.
  categories: {
    buying: "1538742994122051664",
    selling: "1538742994122051664",
    gamble: "1548660800032481360",
    giveaway: "1538743220555743263",
    partnership: "1538742828077940756"
  },

  // Roles exempt from ,s (snipe) — if someone with one of these roles
  // deletes a message, ,s will not be able to show it.
  snipeBypassRoles: [],

  // Only members with this role (or Administrator) can use ,lock / ,unlock
  lockRole: "1493623324956295341",

  // Staff/Builder applications
  applicationPanelChannel: "APPLICATION_PANEL_CHANNEL_ID", // where the panel with the dropdown is posted
  applicationReviewChannels: {
    staff: "1548661075476611093",     // finished staff applications get posted here for Accept/Deny
    builder: "BUILDER_REVIEW_CHANNEL_ID"  // finished builder applications get posted here for Accept/Deny
  },
  applicationTimeLimitMs: 3 * 60 * 60 * 1000, // 3 hours
  applicationsEnabled: {
    staff: true,
    builder: false
  },
  // Role given automatically when an application is accepted
  approvedRoles: {
    staff: "1510924042469900318",
     staff: "1493636195861794857",
    builder: "BUILDER_APPROVED_ROLE_ID"
  },
  // Role pinged in the review channel when a new application comes in
  applicationPingRoles: {
    staff: "1493627473274077336",
    builder: "BUILDER_PING_ROLE_ID"
  },

  // Welcome messages (sent when a new member joins)
  welcome: {
    channel: "1509490403114745867", // channel where the welcome message gets posted
    description: "Welcome! Feel free to make yourself at home."
  }
};

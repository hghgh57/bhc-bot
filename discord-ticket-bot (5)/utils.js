const { PermissionsBitField } = require("discord.js");
const config = require("./config");

function isStaff(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.roles.cache.has(config.bypassRole)
    || member.roles.cache.has(config.staffRole);
}

// Administrator permission or the bypass role specifically — narrower than
// isStaff (which also lets in the regular staffRole). Use this for things
// you want locked to actual admins/owners, not general staff.
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.roles.cache.has(config.bypassRole);
}

module.exports = { isStaff, isAdmin };

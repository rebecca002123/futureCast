// The lockbox only schedules local notifications, which need no push
// entitlement. Removing aps-environment (added automatically because
// expo-notifications is installed) keeps the Push Notifications capability
// out of the provisioning profiles entirely.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPush(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
};

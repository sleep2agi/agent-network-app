// expo-notifications' config plugin always writes `aps-environment` into the iOS entitlements
// (it is meant for remote push). This app only posts *local* notifications on iOS, and its App
// Store provisioning profile has no Push Notifications capability — an unexpected aps-environment
// would make the iOS signing step fail. Remove it again.
//
// Order matters: Expo runs the entitlements mod of the plugin listed LATER first, so this plugin must
// be listed BEFORE "expo-notifications" in app.json for its removal to run after the insertion.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withNoApsEnvironment(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};

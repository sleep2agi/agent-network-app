const { withInfoPlist } = require('expo/config-plugins');

// Register first: Info.plist mods unwind in reverse registration order.
// iOS 10+ ignores ArbitraryLoads when a narrower override key is present.
module.exports = config => withInfoPlist(config, mod => {
  mod.modResults.NSAppTransportSecurity = { NSAllowsArbitraryLoads: true };
  return mod;
});

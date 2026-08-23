import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/ios-build.yml', import.meta.url), 'utf8');
const exportOptions = fs.readFileSync(new URL('../ios-ci/ExportOptions.plist', import.meta.url), 'utf8');
const signingScript = fs.readFileSync(new URL('../scripts/ios-distribution-signing.mjs', import.meta.url), 'utf8');

const checks: Array<[string, boolean]> = [
  ['workflow pins a Swift 6.2-capable Xcode', workflow.includes('DEVELOPER_DIR: /Applications/Xcode_26.2.app/Contents/Developer') && workflow.includes("Apple Swift version 6\\.2")],
  ['archive targets a generic iOS device', workflow.includes("-destination 'generic/platform=iOS'")],
  ['archive manually selects Apple Distribution with the ephemeral profile', workflow.includes('CODE_SIGN_STYLE=Manual') && workflow.includes('CODE_SIGN_IDENTITY="Apple Distribution"') && workflow.includes('PROVISIONING_PROFILE_SPECIFIER=')],
  ['provisioning uses reviewed App Store Connect credentials', workflow.includes('-authenticationKeyPath "$ASC_KEY_PATH"') && signingScript.includes("certificateType: 'IOS_DISTRIBUTION'") && signingScript.includes("profileType: 'IOS_APP_STORE'")],
  ['ephemeral signing assets are always revoked and removed', workflow.includes('if: ${{ always() }}') && signingScript.includes("api('DELETE', `/profiles/") && signingScript.includes("api('DELETE', `/certificates/")],
  ['archive distribution identity and team are verified before export', workflow.indexOf("Print :ApplicationProperties:SigningIdentity") < workflow.indexOf('xcodebuild -exportArchive') && workflow.includes('TeamIdentifier=$APPLE_TEAM_ID')],
  ['App Store profile must not contain registered devices', workflow.includes("Print :ProvisionedDevices") && workflow.includes('expected App Store distribution')],
  ['archive disables debugger entitlement', workflow.includes("Print :Entitlements:get-task-allow") && workflow.includes('= "false"')],
  ['archive application identifier is team plus bundle id', workflow.includes('test "$application_id" = "$APPLE_TEAM_ID.$BUNDLE_ID"')],
  ['native modules are compiled from the checkout', workflow.includes('EXPO_USE_PRECOMPILED_MODULES: "false"')],
  ['iOS build number is numeric and monotonic per Actions run', workflow.includes('IOS_BUILD_NUMBER: ${{ github.run_number }}') && workflow.includes('CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER"')],
  ['export remains App Store distribution and is switched to manual profile signing at runtime', exportOptions.includes('<string>app-store</string>') && workflow.includes("Set :signingStyle manual") && workflow.includes('provisioningProfiles:$BUNDLE_ID')],
  ['IPA artifact is uploaded before optional TestFlight step', workflow.indexOf('name: Upload .ipa artifact') < workflow.indexOf('name: Upload to TestFlight')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

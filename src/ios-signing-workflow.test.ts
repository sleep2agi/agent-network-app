import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/ios-build.yml', import.meta.url), 'utf8');
const exportOptions = fs.readFileSync(new URL('../ios-ci/ExportOptions.plist', import.meta.url), 'utf8');

const checks: Array<[string, boolean]> = [
  ['archive targets a generic iOS device', workflow.includes("-destination 'generic/platform=iOS'")],
  ['archive explicitly selects Apple Distribution', workflow.includes('CODE_SIGN_IDENTITY="Apple Distribution"')],
  ['automatic signing uses reviewed App Store Connect credentials', workflow.includes('-allowProvisioningUpdates') && workflow.includes('-authenticationKeyPath "$ASC_KEY_PATH"')],
  ['archive authority is verified before export', workflow.indexOf("grep -F 'Authority=Apple Distribution:'") < workflow.indexOf('xcodebuild -exportArchive')],
  ['App Store profile must not contain registered devices', workflow.includes("Print :ProvisionedDevices") && workflow.includes('expected App Store distribution')],
  ['archive disables debugger entitlement', workflow.includes("Print :Entitlements:get-task-allow") && workflow.includes('= "false"')],
  ['archive application identifier is team plus bundle id', workflow.includes('test "$application_id" = "$APPLE_TEAM_ID.$BUNDLE_ID"')],
  ['export remains App Store distribution', exportOptions.includes('<string>app-store</string>') && exportOptions.includes('<string>automatic</string>')],
  ['IPA artifact is uploaded before optional TestFlight step', workflow.indexOf('name: Upload .ipa artifact') < workflow.indexOf('name: Upload to TestFlight')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

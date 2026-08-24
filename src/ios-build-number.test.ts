// Every iOS build so far shipped `CFBundleVersion = 1`. The workflow passed
// `CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER"` to xcodebuild and named the
// artifact after the run number, so it looked wired — but app.json pins
// `expo.ios.buildNumber: "1"`, prebuild writes that literal into the generated
// Info.plist, and a literal has nothing for a build setting to expand into.
//
// App Store Connect rejects a reused CFBundleVersion, so the failure would not
// have surfaced at build time at all: it waits for the first TestFlight upload
// after another build with the same number, then rejects.
//
// Two things must stay wired, and this test fails closed if either is removed:
// the injection into the generated plist, and the assertion on the value
// actually inside the archived app.
import fs from 'node:fs';

const workflow = fs
  .readFileSync(new URL('../.github/workflows/ios-build.yml', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

const section = (heading: string): string => {
  const start = workflow.indexOf(heading);
  if (start === -1) return '';
  const rest = workflow.slice(start + heading.length);
  const next = rest.search(/\n      - name: /);
  return next === -1 ? rest : rest.slice(0, next);
};

const injection = section('- name: Inject CFBundleVersion from the run number');
const verify = section('- name: Verify archive uses App Store distribution signing');

const checks: Array<[string, boolean]> = [
  // The build number itself still comes from the run number.
  ['IOS_BUILD_NUMBER is the run number',
    /IOS_BUILD_NUMBER:\s*\$\{\{\s*github\.run_number\s*\}\}/.test(workflow)],

  // Injection step: present, targets the generated plist, uses the env var,
  // and reads the value back rather than trusting the write.
  ['an injection step exists', injection !== ''],
  ['injection writes CFBundleVersion with PlistBuddy',
    /PlistBuddy -c "Set :CFBundleVersion \$IOS_BUILD_NUMBER"/.test(injection)],
  ['injection targets the prebuilt ios Info.plist, not Pods',
    /find ios .*-name Info\.plist -not -path '\*\/Pods\/\*'/.test(injection)],
  ['injection reads the value back and compares it',
    /Print :CFBundleVersion/.test(injection) && /\$IOS_BUILD_NUMBER/.test(injection)],
  ['injection fails closed when the plist is missing',
    /::error::generated ios Info\.plist not found/.test(injection) && /exit 1/.test(injection)],

  // Archive assertion: the value that actually shipped.
  ['the verify step reads the archived app CFBundleVersion',
    /archived_build=\$\(\/usr\/libexec\/PlistBuddy -c 'Print :CFBundleVersion' "\$APP\/Info\.plist"\)/.test(verify)],
  ['the verify step compares it against IOS_BUILD_NUMBER',
    /if \[ "\$archived_build" != "\$IOS_BUILD_NUMBER" \]; then/.test(verify)],
  ['a mismatch is an error and exits non-zero',
    /::error::Archived CFBundleVersion is/.test(verify) && /exit 1/.test(verify)],

  // The setting that looked like it did the job is kept, but is no longer the
  // only thing standing between us and a rejected upload.
  ['CURRENT_PROJECT_VERSION is still passed to xcodebuild',
    /CURRENT_PROJECT_VERSION="\$IOS_BUILD_NUMBER"/.test(workflow)],

  // Ordering: injection must run before the archive, or it archives the old value.
  ['injection comes before the archive step',
    workflow.indexOf('- name: Inject CFBundleVersion from the run number') <
      workflow.indexOf('- name: Archive (xcodebuild)')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`ios build number wiring: ${checks.length} checks passed`);

// Every iOS build so far shipped `CFBundleVersion = 1`. The workflow passed
// `CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER"` to xcodebuild and named the
// artifact after the run number, so it read as wired — but app.json pins
// `expo.ios.buildNumber: "1"`, prebuild writes that literal into the generated
// Info.plist, and a literal has nothing for a build setting to expand into.
//
// App Store Connect rejects a reused CFBundleVersion, so nothing fails at build
// time: it waits for the first upload after another build with the same number.
//
// This file pins the wiring. Each assertion targets a string that exists only
// in the line it is guarding — an earlier revision matched `Print` and
// `$IOS_BUILD_NUMBER` separately, and both occur elsewhere in the same step, so
// deleting the actual comparison still passed. A guard that can be satisfied by
// neighbouring lines is not guarding anything.
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

// Negative assertions run against code only. The step's comments name the very
// constructs being banned — explaining why `mapfile` is unusable on Bash 3.2
// requires writing `mapfile` — and a negation matching the whole section would
// red on its own rationale.
const codeOnly = (yamlSection: string): string =>
  yamlSection
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');

const injectionCode = codeOnly(injection);

const checks: Array<[string, boolean]> = [
  ['IOS_BUILD_NUMBER is the run number',
    /IOS_BUILD_NUMBER:\s*\$\{\{\s*github\.run_number\s*\}\}/.test(workflow)],
  ['an injection step exists', injection !== ''],
  ['injection comes before the archive step',
    workflow.indexOf('- name: Inject CFBundleVersion from the run number') <
      workflow.indexOf('- name: Archive (xcodebuild)')],

  // 1. The build number is validated before anything is written with it.
  ['injection rejects a non-numeric build number',
    /case "\$IOS_BUILD_NUMBER" in\n\s*''\|\*\[!0-9\]\*\)/.test(injection)],
  ['the non-numeric branch errors and exits',
    /::error::IOS_BUILD_NUMBER must be a positive integer/.test(injection)],
  ['injection rejects a non-positive build number',
    /if \[ "\$IOS_BUILD_NUMBER" -le 0 \]; then/.test(injection)],
  ['the non-positive branch errors and exits',
    /::error::IOS_BUILD_NUMBER must be greater than zero/.test(injection)],

  // 2. Exactly one target plist — not "the first one found" — using only
  // constructs Bash 3.2 has, since that is what macOS ships as /bin/bash.
  ['injection writes every candidate to a file, sorted',
    /find ios -maxdepth 2 -name Info\.plist -not -path '\*\/Pods\/\*' \| LC_ALL=C sort > "\$CANDIDATES"/.test(injection)],
  ['injection counts candidates without arrays',
    /count=\$\(wc -l < "\$CANDIDATES" \| tr -d '\[:space:\]'\)/.test(injection)],
  ['injection requires exactly one candidate',
    /if \[ "\$count" -ne 1 \]; then/.test(injection)],
  ['the ambiguous/missing case errors and exits',
    /::error::expected exactly 1 generated ios Info\.plist outside Pods, found \$count/.test(injection)],
  ['candidates are only enumerated when there is at least one',
    /if \[ "\$count" -gt 0 \]; then/.test(injection)],
  ['enumeration preserves spaces in paths',
    /while IFS= read -r candidate; do/.test(injection) && /done < "\$CANDIDATES"/.test(injection)],
  ['the single candidate is read back preserving spaces',
    /PLIST=\$\(sed -n '1p' "\$CANDIDATES"\)/.test(injection)],
  ['injection uses no Bash 4 array builtins',
    !/\bmapfile\b/.test(injectionCode) && !/\breadarray\b/.test(injectionCode)],
  ['injection never silently takes the first match',
    !/-print -quit/.test(injectionCode)],

  // 3. Set, not Add — a missing key must fail rather than be created.
  ['injection writes with Set',
    /\/usr\/libexec\/PlistBuddy -c "Set :CFBundleVersion \$IOS_BUILD_NUMBER" "\$PLIST"/.test(injection)],
  ['injection does not Add the key',
    !/PlistBuddy -c "Add :CFBundleVersion/.test(injection)],

  // 4. The write is read back and *actually compared*, with a failing exit.
  ['injection reads the written value back',
    /written=\$\(\/usr\/libexec\/PlistBuddy -c 'Print :CFBundleVersion' "\$PLIST"\)/.test(injection)],
  ['injection compares the read-back against the build number',
    /if \[ "\$written" != "\$IOS_BUILD_NUMBER" \]; then/.test(injection)],
  ['the read-back mismatch errors and exits',
    /::error::CFBundleVersion is \$written after injection, expected \$IOS_BUILD_NUMBER/.test(injection)],

  // 5. The value that actually shipped: read from the archived app.
  ['the verify step reads the archived app CFBundleVersion',
    /archived_build=\$\(\/usr\/libexec\/PlistBuddy -c 'Print :CFBundleVersion' "\$APP\/Info\.plist"\)/.test(verify)],
  ['the verify step compares it against IOS_BUILD_NUMBER',
    /if \[ "\$archived_build" != "\$IOS_BUILD_NUMBER" \]; then/.test(verify)],
  ['the archive mismatch errors and exits',
    /::error::Archived CFBundleVersion is \$archived_build, expected \$IOS_BUILD_NUMBER/.test(verify)],

  ['CURRENT_PROJECT_VERSION is still passed to xcodebuild',
    /CURRENT_PROJECT_VERSION="\$IOS_BUILD_NUMBER"/.test(workflow)],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`ios build number wiring: ${checks.length} checks passed`);

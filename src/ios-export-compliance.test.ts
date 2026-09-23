// iOS export compliance: the app uses only OS-provided HTTPS/TLS (exempt
// encryption). app.json must carry ITSAppUsesNonExemptEncryption=false so every
// Expo-prebuilt Info.plist skips the App Store Connect compliance question, and
// the status workflow's compliance-only mode must never touch groups or review.
import fs from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log('FAIL', n); };

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const plist = app?.expo?.ios?.infoPlist ?? {};
ck('app.json expo.ios.infoPlist declares ITSAppUsesNonExemptEncryption', 'ITSAppUsesNonExemptEncryption' in plist);
ck('ITSAppUsesNonExemptEncryption is boolean false', plist.ITSAppUsesNonExemptEncryption === false);

const wf = fs.readFileSync('.github/workflows/ios-testflight-status.yml', 'utf8').replace(/\r\n?/g, '\n');
ck('status workflow has set_export_compliance_only input', /\n      set_export_compliance_only:\n/.test(wf));
const start = wf.indexOf(`if [ "$SET_EXPORT_COMPLIANCE_ONLY" = 'true' ]; then`);
const end = wf.indexOf(`if [ "$ENABLE_PUBLIC_TESTING" = 'true' ]; then\n            group_id=`);
ck('compliance-only block exists before the public-testing block', start > 0 && end > start);
const block = wf.slice(start, end);
ck('compliance-only block patches usesNonExemptEncryption:false', block.includes('usesNonExemptEncryption:false'));
ck('compliance-only block never touches beta groups', !/betaGroups/.test(block));
ck('compliance-only block never submits for beta review', !/betaAppReviewSubmissions/.test(block));
ck('the two modes are mutually exclusive', wf.includes('set_export_compliance_only and enable_public_testing are mutually exclusive'));

console.log(`ios export compliance: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);

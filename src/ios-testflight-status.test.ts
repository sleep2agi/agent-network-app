// ios-testflight-status.yml: Apple's error body must reach the log on any
// non-2xx (curl --fail-with-body into a redirected file printed only "403"),
// and the opt-in group listing / distribution must stay off by default.
import fs from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log('FAIL', n); };

const wf = fs.readFileSync('.github/workflows/ios-testflight-status.yml', 'utf8').replace(/\r\n?/g, '\n');
ck('no curl call fails silently with --fail-with-body', !wf.includes('--fail-with-body'));
ck('non-2xx prints status + endpoint', wf.includes('App Store Connect $method /v1/$endpoint returned HTTP $code'));
ck('non-2xx prints Apple errors[] status/code/title/detail', /\.errors\[\]\? \| .*\.status.*\.code.*\.title.*\.detail/.test(wf));
ck('error path never echoes the JWT', !/echo[^\n]*\$jwt/.test(wf));
ck('JWT iat is back-dated like scripts/ios-distribution-signing.mjs', wf.includes('iat: now - 5,'));
ck('list_beta_groups defaults to false', /\n      list_beta_groups:\n(?:        .*\n)*?        default: false\n/.test(wf));
ck('distribute_to_groups defaults to empty', /\n      distribute_to_groups:\n(?:        .*\n)*?        default: ""\n/.test(wf));
const dist = wf.slice(wf.indexOf('if [ -n "$DISTRIBUTE_TO_GROUPS" ]; then'), wf.indexOf('reviews_json="$RUNNER_TEMP/reviews.json"'));
ck('distribution block exists', dist.length > 100);
ck('distribution refuses a build that is not VALID before any write', dist.indexOf(`[ "$processing" != 'VALID' ]`) > 0 && dist.indexOf(`[ "$processing" != 'VALID' ]`) < dist.indexOf('asc_write'));
ck('distribution only POSTs builds to beta groups', (dist.match(/asc_write \w+ "[^"]+"/g) || []).every(w => w === 'asc_write POST "betaGroups/$group_id/relationships/builds"'));
ck('distribution never submits for beta review', !dist.includes('betaAppReviewSubmissions'));
ck('hasAccessToAllBuilds groups are skipped, not attached', dist.indexOf('hasAccessToAllBuilds') < dist.indexOf('asc_write'));
const list = wf.slice(wf.indexOf(`if [ "$LIST_BETA_GROUPS" = 'true' ]; then`), wf.indexOf(`echo 'TestFlight status (credentials`));
ck('group listing prints the requested flags', ['isInternalGroup', 'hasAccessToAllBuilds', 'publicLinkEnabled'].every(k => list.includes(k)));
ck('group listing never reads testers', list.length > 0 && !/betaTesters|email/i.test(list));

console.log(`ios testflight status: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);

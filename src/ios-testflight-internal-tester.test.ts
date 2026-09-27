// TestFlight internal-tester workflow: the Apple ID email is personal data and
// this repository is public. The value must never reach the Actions log unmasked:
// no `${{ inputs.email }}` expression (substituted into script text / env, which
// the log prints before any ::add-mask:: runs), masked on the first line, never
// echoed or written to the step summary. `list` mode must never write to ASC.
import fs from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log('FAIL', n); };

const path = '.github/workflows/ios-testflight-internal-tester.yml';
const wf = fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

ck('workflow_dispatch only', /\non:\n  workflow_dispatch:\n/.test(wf) && !/\n  (push|pull_request|schedule|release):/.test(wf));
ck('mode is a list/add/grant-builds choice, default list', /\n      mode:\n[\s\S]*?type: choice\n\s+options: \[list, add, grant-builds\]\n\s+default: list\n/.test(wf));
ck('email input is optional with an empty default', /\n      email:\n[\s\S]*?required: false\n\s+default: ""\n/.test(wf));
ck('runs in the protected macos-signing environment', /\n    environment: macos-signing\n/.test(wf));
ck('read-only repository token', /\npermissions:\n  contents: read\n/.test(wf));

// The email never goes through an expression (script text and env are logged unmasked).
ck('no ${{ inputs.email }} expression', !/\$\{\{\s*inputs\.email\s*\}\}/.test(code));
ck('no ${{ github.event.inputs.email }} expression', !/github\.event\.inputs\.email/.test(code));
ck('no EMAIL entry in any env block', !/\n\s+EMAIL:\s/.test(code));

const run = code.slice(code.indexOf('        run: |\n') + '        run: |\n'.length);
const firstLine = run.split('\n')[0].trim();
ck('first script line reads the email from the event payload file', firstLine.startsWith(`EMAIL=$(jq -r '.inputs.email // ""' "$GITHUB_EVENT_PATH"`));
ck('first script line masks it', /echo "::add-mask::\$EMAIL"/.test(firstLine));
ck('the lower-cased variant is masked too', run.includes('echo "::add-mask::$email_lc"'));

// Never printed.
const echoLines = run.split('\n').filter((l) => /\becho\b|printf/.test(l));
ck('no echo/printf of $EMAIL other than the mask line', echoLines.filter((l) => /\$EMAIL\b|\$\{EMAIL\}/.test(l) && !l.includes('::add-mask::') && !/printf '%s' "\$EMAIL" \| tr/.test(l)).length === 0);
ck('no echo/printf of $email_lc other than the mask line', echoLines.filter((l) => /\$email_lc\b/.test(l) && !l.includes('::add-mask::')).length === 0);
ck('never writes the step summary', !code.includes('GITHUB_STEP_SUMMARY'));
ck('never writes GITHUB_OUTPUT or GITHUB_ENV', !code.includes('GITHUB_OUTPUT') && !code.includes('GITHUB_ENV'));
ck('never prints tester emails (no jq -r of .attributes.email)', !/jq -r[^\n]*attributes\.email/.test(run));
ck('request body with the email is deleted after use', run.includes('rm -f "$RUNNER_TEMP/add-body.json"'));

// list never writes.
const writes = run.split('\n').map((l, i) => ({ l, i })).filter(({ l }) => /asc_write (POST|PATCH|DELETE)/.test(l));
ck('writes are exactly: create group, link tester, create tester, PATCH group, attach build', writes.length === 5);
const listGuard = run.indexOf(`if [ "$MODE" != 'add' ]; then`);
const addGuard = run.indexOf(`if [ "$MODE" = 'add' ]; then\n            if [ "$in_group" = 'yes' ]`);
const groupCreate = run.indexOf('asc_write POST betaGroups ');
ck('group creation sits in the else of a not-add guard (list and grant-builds never create)', listGuard > 0 && groupCreate > listGuard && run.slice(listGuard, groupCreate).includes('\n            else\n'));
ck('tester writes sit inside the add-mode block', addGuard > 0 && writes.filter(({ l }) => l.includes('betaTesters')).every(({ l }) => run.indexOf(l) > addGuard));
ck('already-in-group short-circuits before any tester write', run.indexOf(`if [ "$in_group" = 'yes' ]; then`) < run.indexOf('asc_write POST "betaGroups/$group_id/relationships/betaTesters"'));

// Behaviour of the add path.
ck('existing account tester is linked to the group instead of re-created', run.includes('betaGroups/$group_id/relationships/betaTesters'));
ck('new tester is created with the group relationship', run.includes('relationships:{betaGroups:{data:[{type:"betaGroups",id:$group}]}}'));
ck('created group is internal with all builds', run.includes('isInternalGroup:true,hasAccessToAllBuilds:true'));
ck('rejection explains the App Store Connect user requirement', run.includes('Internal TestFlight testers must be App Store Connect users on team 446BLT75JZ'));
ck('tester lists follow pagination', run.includes(`url=$(jq -r '.links.next // empty' "$page")`));

// grant-builds: (1) hasAccessToAllBuilds, (2) attach only if still missing, both read back from ASC.
const grantStart = run.indexOf(`if [ "$MODE" = 'grant-builds' ]; then\n            if [ "$all_builds" = 'yes' ]`);
const grantEnd = run.indexOf('build_state=not-found');
const grant = run.slice(grantStart, grantEnd);
ck('grant-builds block exists before the summary', grantStart > 0 && grantEnd > grantStart);
ck('grant PATCHes only hasAccessToAllBuilds:true on the group', grant.includes('attributes:{hasAccessToAllBuilds:true}') && grant.includes('asc_write PATCH "betaGroups/$group_id"'));
ck('PATCH only when the read-back says the group lacks it', grant.indexOf(`if [ "$all_builds" = 'yes' ]; then`) >= 0 && grant.indexOf(`if [ "$all_builds" = 'yes' ]; then`) < grant.indexOf('asc_write PATCH'));
const listedIf = grant.indexOf(`if [ "$build_listed" = 'yes' ]; then`);
const attach = grant.indexOf('asc_write POST "betaGroups/$group_id/relationships/builds"');
ck('explicit attach only in the else of "build listed after step 1"', listedIf > 0 && attach > listedIf && grant.slice(listedIf, attach).includes('\n            else\n') && grant.indexOf('asc_write PATCH') < listedIf);
ck('state is re-read from ASC after each grant write', (grant.match(/\n\s+read_group_state\n/g) || []).length === 2);
ck('read-back reads the group itself and its builds relationship', run.includes('asc_get "betaGroups/$group_id" >') && run.includes('betaGroups/$group_id/relationships/builds?limit=200'));
ck('group and tester writes are not in the grant block', !/betaTesters|asc_write POST betaGroups /.test(grant));
ck('summary reports internalBuildState from buildBetaDetails', run.includes("internalBuildState // \"UNKNOWN\"") && run.includes('internalBuildState:         $internal_state'));
ck('grant-builds fails the job unless the read-back confirms both', run.includes(`if [ "$MODE" = 'grant-builds' ] && { [ "$all_builds" != 'yes' ] || [ "$build_listed" != 'yes' ]; }; then`));

console.log(`ios TestFlight internal tester: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);

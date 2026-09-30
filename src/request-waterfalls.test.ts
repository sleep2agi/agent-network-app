// @ts-nocheck -- repository test scripts run directly under Bun.
// Independent hub reads must be started together, not chained: every link in a chain is one
// more trans-Pacific round trip (0.22 s warm, ~0.7 s on a fresh desktop connection).
// Measured with the web export + a 220 ms/request latency model (PR body has the timelines).
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const before = (s: string, a: string, b: string) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);

// ── chat list: status + both unread reads start before the first await ──
const agents = src('AgentsScreen.tsx');
const load = agents.slice(agents.indexOf('const load = useCallback(async () => {'), agents.indexOf('}, [cfg, preview]);'));
const firstAwait = load.indexOf('await ');
ck('chat list starts the status read before awaiting anything', load.indexOf('fetchStatus(cfg)') >= 0 && load.indexOf('fetchStatus(cfg)') < firstAwait);
ck('chat list starts the user-inbox unread read before awaiting anything', load.indexOf('fetchUserMessages(cfg, 50)') >= 0 && load.indexOf('fetchUserMessages(cfg, 50)') < firstAwait);
ck('chat list starts the reply-unread read before awaiting anything', load.indexOf('fetchReplyInbox(cfg)') >= 0 && load.indexOf('fetchReplyInbox(cfg)') < firstAwait);
ck('early-started reads never surface as unhandled rejections', /userMessagesRead\.catch\(\(\) => \{\}\)/.test(load) && /inboxRead\.catch\(\(\) => \{\}\)/.test(load));
ck('unread bodies are still applied in the old order (status → user inbox → replies)', before(load, 'await statusRead', 'await userMessagesRead') && before(load, 'await userMessagesRead', 'await inboxRead'));

// ── task board: projects read starts with the list, not after it ──
const board = src('RequirementBoard.tsx');
const firstLoad = board.slice(board.indexOf('// ── 读 Hub ──'), board.indexOf('const refresh = useCallback'));
ck('task board starts the projects read before the list read resolves', before(firstLoad, 'listProjects(cfg)', 'await listRequirementsFull(cfg)'));
ck('task board awaits the early projects read instead of issuing a second one', /await projectsRead/.test(firstLoad) && (firstLoad.match(/listProjects\(cfg\)/g) || []).length === 1);
const refresh = board.slice(board.indexOf('const refresh = useCallback'), board.indexOf('usePoll(refresh'));
ck('poll skips a full-list read right after one landed (phase→ready re-runs the poll at once)', /if \(!force && Date\.now\(\) - lastListAt\.current < POLL_MS \/ 2\) return;/.test(refresh));
ck('first load and every poll stamp lastListAt', (board.match(/lastListAt\.current = Date\.now\(\);/g) || []).length === 2);
ck('a task-changed event from another window still refreshes at once', /refreshRef\.current\(true\)/.test(board));

// ── node detail: nodes + status together, loaded once at mount ──
const detail = src('NodeDetailScreen.tsx');
const dLoad = detail.slice(detail.indexOf('const load = useCallback(async () => {'), detail.indexOf('}, [cfg, alias]);'));
ck('node detail starts the nodes read before awaiting the status read', before(dLoad, 'fetchHubNodes(cfg)', 'await fetchNodeStatus(cfg, alias)'));
ck('node detail has no mount effect duplicating usePoll\'s first run', !/useEffect\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\);/.test(detail) && /usePoll\(load, POLL_MS, \[load\]\)/.test(detail));

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);

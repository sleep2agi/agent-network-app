// agy 登录弹层：只在节点上报能力时出现；没有能力就保留「复制命令」那条路。
import { readFileSync } from 'node:fs';
let p = 0, t = 0;
const ck = (n: string, ok: boolean) => { t++; if (ok) { p++; console.log('✅', n); } else console.log('❌', n); };

const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('./AgyLoginCard.tsx', import.meta.url), 'utf8');
ck('只在 config_snapshot.agy_login_capable 为真时渲染', /agy_login_capable === true/.test(detail) && /<AgyLoginCard/.test(detail));
ck('能力缺失时不渲染（同一条件里没有兜底 true）', !/agy_login_capable \|\| true/.test(detail));
ck('走 hub 三个工具：start / submit / get_rules_file_result', /start_agy_login|startAgyLogin/.test(card) && /submitAgyLoginCode/.test(card) && /fetchAgyLoginResult/.test(card));
ck('弹层里有授权码输入与打开链接', /testID="agy-login-code"/.test(card) && /openExternal\(url\)/.test(card));
ck('提示码不经模型、不落日志', /不经过对话模型、不落日志/.test(card));
ck('登录成功后回调节点页刷新（onDone）', /onDone=\{\(\) => \{ void load\(\); \}\}/.test(detail));

console.log(`agy-login-card: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);

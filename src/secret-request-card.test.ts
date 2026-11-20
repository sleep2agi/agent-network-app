// 密钥卡片的守护断言：值不进任何文案/无障碍标签，保存后只回 key 名。
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

const card = readFileSync(new URL('./SecretRequestCard.tsx', import.meta.url), 'utf8');

ck('输入框是密码样式', /secureTextEntry/.test(card));
ck('卡片写明内容不进聊天', /内容不会出现在聊天里/.test(card) && /agent 也看不到/.test(card));
ck('保存后只显示「{key} 已保存。」', /已保存。`/.test(card));
ck('提交按钮的可读标签只含 key', /accessibilityLabel=\{`保存 \$\{request\.key\}`\}/.test(card));
ck('值只在输入框与 onSave 参数里', /onSave\(value\)/.test(card) && !/console\.(log|info|warn|error)/.test(card));
ck('testID 稳定（drive 用）', /secret-request-card/.test(card) && /-input`/.test(card) && /-submit`/.test(card));

console.log(`secret-request-card: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);

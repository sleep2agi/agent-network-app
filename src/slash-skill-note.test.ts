// #886 —— 技能候选旁必须有一句边界说明：技能是给 Agent 的提示，不是 Runtime 原生命令。
//   run: bun src/slash-skill-note.test.ts
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const suggest = readFileSync(new URL('./ComposerSuggest.tsx', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('./i18n-chat.ts', import.meta.url), 'utf8');

ck('斜杠行带 kind（命令 / 技能）', chat.includes('kind: item.group,'));
ck('只有出现技能时才给说明', chat.includes("slashRows.some(row => row.kind === 'skill') ? t('chat.slash.skillNote') : undefined"));
ck('两个输入框都把 note 传下去', (chat.match(/note=\{slashSkillBoundaryNote\}/g) ?? []).length === 2);
ck('composer-suggest 有 note 文案位 + testID', suggest.includes('testID="composer-suggest-note"') && suggest.includes('{note ?'));
ck('note 有样式（分隔线 + 弱化色）', /note: \{ color: colors\.textMuted/.test(suggest));
ck('中英文案都在，且明说「不是原生命令」', /'chat\.slash\.skillNote': \['[^']*不是[^']*原生命令[^']*', '[^']*not native runtime commands[^']*'\]/.test(i18n));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);

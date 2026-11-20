// #886 —— / 菜单的两个边界：读不到技能时不能留上一个节点的旧候选；输入法组字时不拦键。
//   run: bun src/slash-menu-gaps.test.ts
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };
const src = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');

// 读技能失败/不支持时清空候选（三个分支：没 follow、结果异常、抛异常）
ck('没拿到 follow 就清空候选', /if \(!follow\) \{\s*\n\s*\/\/[^\n]*\n\s*if \(live\) \{ setSlashSkills\(\[\]\); setSlashSkillNote/.test(src));
ck('结果异常时清空候选', /if \(problem !== null \|\| !result\.ok \|\| result\.status !== 'done'\) \{\s*\n\s*setSlashSkills\(\[\]\);/.test(src));
ck('抛异常时清空候选', /if \(live\) \{ setSlashSkills\(\[\]\); setSlashSkillNote\(error instanceof Error/.test(src));
ck('不支持（非 skills_capable）仍然清空', src.includes('if (live) { setSlashSkills([]); setSlashSkillNote(t("chat.slash.unsupported")); }'));

// 输入法组字：不拦 Enter/Tab/上下键，避免把确认候选当成选菜单
ck('组字时不拦键', src.includes('if (event.nativeEvent?.isComposing) return false;'));
ck('isComposing 判断在键位处理之前', src.indexOf('isComposing) return false;') < src.indexOf("if (key === 'ArrowDown' || key === 'ArrowUp')"));

// 选择只填草稿，不发送
ck('选候选只 setDraft', /const pickSuggest = \(index: number\) => \{[\s\S]{0,220}setDraft\(row\.insert\);/.test(src) && !/pickSuggest[\s\S]{0,220}void submit\(\)/.test(src));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);

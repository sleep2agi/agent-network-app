// 账号页头像加载约束（review 2026-11-23）：
// ① 受保护路径必须走 UserAvatarImage（带 hubUrl + token），不能裸 <Image source={{uri}}>
// ② 非法 URL 不发请求（UserAvatarImage 内部挡掉）⇒ 保留底层字标
// ③ 加载失败 onError ⇒ 回落字标
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const kit = readFileSync(join(import.meta.dir, 'settings-kit.tsx'), 'utf8');
const screen = readFileSync(join(import.meta.dir, 'SettingsScreen.tsx'), 'utf8');
let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; } else console.log('❌', n); };

ck('字标永远在底层（先渲染 Text，再叠图片）',
  /<Text[\s\S]{0,120}?\{\(name \|\| '\?'\)\.trim\(\)\.slice\(0, 1\)\.toUpperCase\(\)\}[\s\S]{0,400}?showImage \?/.test(kit));
ck('图片走 UserAvatarImage（不是裸 Image）',
  kit.includes('import UserAvatarImage') && /<UserAvatarImage[\s\S]{0,200}?value=\{avatarUrl!\}[\s\S]{0,200}?hubUrl=\{hubUrl!\}/.test(kit));
ck('没有裸 <Image source={{ uri: avatarUrl }}>', !/Image[^>]*source=\{\{\s*uri:\s*avatarUrl/.test(kit));
ck('onError 后置 failed，图片不再渲染', /onError=\{\(\) => setFailed\(true\)\}/.test(kit) && /const showImage = .*&& !failed/.test(kit));
ck('不使用卡通插画兜底（不引入 human-avatar / 不调 sourceForFile）',
  !/from '\.\/human-avatar'/.test(kit) && !kit.includes('sourceForFile('));
ck('行/卡片把 hubUrl + token 透传到头像组件',
  /SettingsLetterAvatar[^>]*hubUrl=\{hubUrl\}[^>]*token=\{token\}/.test(kit));
ck('设置页给当前账号传 hubUrl + token', screen.includes('hubUrl={cfg.serverUrl}') && screen.includes('token={cfg.token}'));

console.log(`${p}/${t} passed`);
if (p !== t) process.exit(1);

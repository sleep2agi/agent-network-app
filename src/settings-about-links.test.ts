import { readFileSync } from 'node:fs';

/** 关于页的两个外链(App Store 审核会找「隐私政策」;用户找客服要有路)。
 *  这里只钉住「指向哪儿、用什么打开」,不测渲染。 */
let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else throw new Error(`FAIL: ${name}`);
};

const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const copy = readFileSync(new URL('./i18n-settings.ts', import.meta.url), 'utf8');

check('关于页有隐私政策入口，指向 https://www.anet.sh/privacy',
  settings.includes("testID=\"settings-privacy-link\"") && settings.includes("openExternal('https://www.anet.sh/privacy')"));
check('关于页有官网/支持入口，指向站点根',
  settings.includes("testID=\"settings-support-link\"") && /openExternal\('https:\/\/www\.anet\.sh'\)/.test(settings));
check('两个链接都走 openExternal（iOS 上先 canOpenURL），不内嵌 webview',
  settings.includes("from './open-external'") && !settings.includes("WebView"));
check('文案键是末尾追加的两条(292/293)，没有插在中间打乱旧编号',
  settings.includes("tr('settings.copy.292')") && settings.includes("tr('settings.copy.293')")
  && copy.indexOf("['隐私政策', 'Privacy policy']") > copy.indexOf("['服务器：', 'Server: ']")
  && copy.indexOf("['官网与支持', 'Website & support']") > copy.indexOf("['隐私政策', 'Privacy policy']"));
check('文案有中英两版', copy.includes("['隐私政策', 'Privacy policy']") && copy.includes("['官网与支持', 'Website & support']"));

console.log(`settings about links: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);

import { readFileSync } from 'node:fs';
import { IOS_UPDATE_ROW, TESTFLIGHT_APP_URL, TESTFLIGHT_PUBLIC_URL, openTestFlight, type LinkingLike } from './ios-testflight';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

const fake = (can: boolean | 'throw') => {
  const opened: string[] = [];
  const linking: LinkingLike = {
    canOpenURL: async () => { if (can === 'throw') throw new Error('not allowed'); return can; },
    openURL: async url => { opened.push(url); },
  };
  return { linking, opened };
};

// the iOS row says what to do and is tappable (not the dead-end 「当前环境不支持自动更新」)
ck('iOS row label points at TestFlight', IOS_UPDATE_ROW.label === '通过 TestFlight 更新');
ck('iOS row is tappable (chevron shows)', IOS_UPDATE_ROW.actionable && !IOS_UPDATE_ROW.busy);

{
  const { linking, opened } = fake(true);
  const url = await openTestFlight(linking);
  ck('TestFlight installed → opens itms-beta://', url === TESTFLIGHT_APP_URL && opened.join() === TESTFLIGHT_APP_URL);
}
{
  const { linking, opened } = fake(false);
  const url = await openTestFlight(linking);
  ck('canOpenURL false → public TestFlight link', url === TESTFLIGHT_PUBLIC_URL && opened.join() === TESTFLIGHT_PUBLIC_URL);
}
{
  const { linking, opened } = fake('throw');
  const url = await openTestFlight(linking);
  ck('canOpenURL throws → public TestFlight link', url === TESTFLIGHT_PUBLIC_URL && opened.join() === TESTFLIGHT_PUBLIC_URL);
}

// canOpenURL('itms-beta://') returns false on iOS unless the scheme is whitelisted in Info.plist.
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const schemes: unknown = app?.expo?.ios?.infoPlist?.LSApplicationQueriesSchemes;
ck('app.json whitelists itms-beta for canOpenURL', Array.isArray(schemes) && schemes.includes('itms-beta'));

// Both update rows (phone page ctx + wide 关于 section) branch on iOS before Android / desktop.
const screen = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
ck('both update views use IOS_UPDATE_ROW on iOS', (screen.match(/isIOS \? IOS_UPDATE_ROW : isAndroid/g) ?? []).length === 2);
ck('both update taps open TestFlight on iOS', (screen.match(/if \(isIOS\) void openTestFlight\(Linking\);/g) ?? []).length === 2);

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);

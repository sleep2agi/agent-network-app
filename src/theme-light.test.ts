import { readFileSync } from 'node:fs';
import { colors, setThemeMode } from './theme';

function ck(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

setThemeMode('light');
ck('light workspace is a neutral gray canvas', colors.bg === '#f6f7f9');
ck('light cards are white and distinct from canvas', colors.card === '#ffffff' && colors.card !== colors.bg);
ck('light inputs retain a separate subtle surface', colors.inputBg === '#f1f2f5' && colors.inputBg !== colors.card);
ck('light borders are visible', colors.border === '#e6e8ec');

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
ck('desktop styles are built per themed workspace mount',
  app.includes('const desktopStyles = useMemo(makeDesktopStyles, [])') &&
  app.includes('const makeDesktopStyles = () => StyleSheet.create'));
ck('desktop themed workspace imports useMemo', /import \{[^}]*\buseMemo\b[^}]*\} from 'react';/.test(app));

const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
ck('settings owns its themed background', settings.includes('backgroundColor: colors.bg'));

const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
// 极简(2026-09-24):两种主题的行都平铺;选中/悬停改用 token,不再有浅色专用的 hex 字面量。
ck('compact agent rows are flat rather than card stacks', agents.includes("backgroundColor: 'transparent'"));
ck('selected agent uses the quiet neutral rowActive token', agents.includes('backgroundColor: colors.rowActive') && colors.rowActive === '#e9ebee');
ck('agent list carries no light-only hex literals', !/'#[0-9a-fA-F]{6}'/.test(agents));

setThemeMode('dark');

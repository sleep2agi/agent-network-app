import { readFileSync } from 'node:fs';
import { colors, setThemeMode } from './theme';

function ck(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

setThemeMode('light');
ck('light workspace is a neutral gray canvas', colors.bg === '#f4f6f8');
ck('light cards are white and distinct from canvas', colors.card === '#ffffff' && colors.card !== colors.bg);
ck('light inputs retain a separate subtle surface', colors.inputBg === '#eef1f4' && colors.inputBg !== colors.card);
ck('light borders are visible', colors.border === '#e1e5ea');

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
ck('desktop styles are built per themed workspace mount',
  app.includes('const desktopStyles = useMemo(makeDesktopStyles, [])') &&
  app.includes('const makeDesktopStyles = () => StyleSheet.create'));
ck('desktop themed workspace imports useMemo', app.includes('useEffect, useMemo, useState'));

const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
ck('settings owns its themed background', settings.includes('backgroundColor: colors.bg'));

const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
ck('light compact agent rows are flat rather than card stacks', agents.includes("backgroundColor: themeMode() === 'light' ? 'transparent' : colors.card"));
ck('light selected agent uses a quiet neutral highlight', agents.includes("'#e7e9ec'"));

setThemeMode('dark');

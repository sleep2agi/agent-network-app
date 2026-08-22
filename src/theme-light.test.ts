import { readFileSync } from 'node:fs';
import { colors, setThemeMode } from './theme';

function ck(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

setThemeMode('light');
ck('light workspace is a neutral gray canvas', colors.bg === '#f3f4f6');
ck('light cards are white and distinct from canvas', colors.card === '#ffffff' && colors.card !== colors.bg);
ck('light inputs retain a separate subtle surface', colors.inputBg === '#f8fafc' && colors.inputBg !== colors.card);
ck('light borders are visible', colors.border === '#d9dce1');

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
ck('desktop styles are built per themed workspace mount',
  app.includes('const desktopStyles = useMemo(makeDesktopStyles, [])') &&
  app.includes('const makeDesktopStyles = () => StyleSheet.create'));

const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
ck('settings owns its themed background', settings.includes('backgroundColor: colors.bg'));

setThemeMode('dark');

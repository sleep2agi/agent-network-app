import { currentLanguage } from './i18n';
import { settingsText } from './i18n-settings';
import { themePreferenceSummary, THEME_PREFERENCE_LABEL, type ThemePreference, type ThemeMode } from './theme';
import { uiScaleSummary, FONT_SIZE_OPTIONS, DENSITY_OPTIONS, OS_FONT_SCALE_MAX, type ResolvedUiScale } from './ui-scale';
import { statusLabel, type VoiceConfigStatus } from './voice-credentials-model';

export function localizedVoiceStatus(status: VoiceConfigStatus): string {
  if (currentLanguage() === 'zh') return statusLabel(status);
  return status.configured ? `Configured ✓ ${status.tokenTail}` : 'Not configured';
}

export function localizedThemeSummary(pref: ThemePreference, mode: ThemeMode): string {
  if (currentLanguage() === 'zh') return themePreferenceSummary(pref, mode);
  return pref === 'system' ? `Follow system (currently ${settingsText(THEME_PREFERENCE_LABEL[mode])})` : settingsText(THEME_PREFERENCE_LABEL[pref]);
}
export function localizedScaleSummary(r: ResolvedUiScale, wide: boolean) {
  if (currentLanguage() === 'zh') return uiScaleSummary(r, wide);
  const font = settingsText(FONT_SIZE_OPTIONS.find(o => o.key === r.font)?.label ?? r.font);
  const density = settingsText(DENSITY_OPTIONS.find(o => o.key === r.density)?.label ?? r.density);
  return {
    font: font + (r.fontIsDefault ? ' (default)' : ''),
    density: density + (r.densityIsDefault ? wide ? ' (wide-screen default)' : ' (default)' : ''),
    osNote: Math.abs(r.osFontScale - 1) < 0.005 ? null : r.osFontScale > OS_FONT_SCALE_MAX ? `System font ×${r.osFontScale.toFixed(2)}, capped at ×${OS_FONT_SCALE_MAX.toFixed(2)}; choose Large or Extra large for more` : `Includes system font ×${r.osFontScale.toFixed(2)}`,
  };
}

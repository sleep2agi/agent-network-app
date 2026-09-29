import { useSyncExternalStore } from 'react';
import { currentLanguage, languagePreference, languageSnapshot, setLanguagePreference, subscribeLanguage, t } from './i18n';

/** Re-render, never remount: language switching preserves drafts and navigation. */
export function useTranslation() {
  useSyncExternalStore(subscribeLanguage, languageSnapshot, languageSnapshot);
  return { t, preference: languagePreference(), language: currentLanguage(), setPreference: setLanguagePreference };
}

import { AppState, Platform } from 'react-native';
import { acceptLanguageStorage, hydrateLanguage, LANGUAGE_STORAGE_KEY, refreshSystemLanguage } from './i18n';

let installed = false;
export function installLanguageRuntime(): void {
  if (installed) return;
  installed = true;
  refreshSystemLanguage();
  AppState.addEventListener('change', state => { if (state === 'active') refreshSystemLanguage(); });
  if (Platform.OS === 'web') {
    window.addEventListener('languagechange', () => refreshSystemLanguage());
    window.addEventListener('storage', event => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) acceptLanguageStorage(event.newValue);
    });
  } else {
    const fileSystem = import('expo-file-system/legacy');
    let queue = Promise.resolve();
    void hydrateLanguage(async () => {
      const fs = await fileSystem;
      if (!fs.documentDirectory) return null;
      const path = `${fs.documentDirectory}language_v1.txt`;
      return (await fs.getInfoAsync(path)).exists ? fs.readAsStringAsync(path) : null;
    }, value => {
      queue = queue.then(async () => {
        const fs = await fileSystem;
        if (fs.documentDirectory) await fs.writeAsStringAsync(`${fs.documentDirectory}language_v1.txt`, value);
      }).catch(() => { /* Session preference survives write failure. */ });
    });
  }
}

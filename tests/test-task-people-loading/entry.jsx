import React from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Board from '../../src/RequirementBoard';
import { setLanguagePreference } from '../../src/i18n';
import { setThemePreference } from '../../src/theme';
setThemePreference('light'); setLanguagePreference('zh');
createRoot(document.getElementById('root')).render(<SafeAreaProvider><Board desktop={innerWidth>700} cfg={{serverUrl:location.origin,token:'fixture',networkId:'fixture-network'}} /></SafeAreaProvider>);

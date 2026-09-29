import React from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Board from '../../src/RequirementBoard';
import { setThemePreference } from '../../src/theme';
// ?zeroLayout=1: onLayout never reports a width (react-native-web measures through ResizeObserver) —
// the board has to lay out from the window-width fallback, which is what a native first pass at 0 looks like.
if (new URLSearchParams(location.search).get('zeroLayout') === '1') window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
setThemePreference('light');
createRoot(document.getElementById('root')).render(<SafeAreaProvider><Board cfg={{serverUrl:location.origin,token:'fixture',networkId:'fixture-network'}} /></SafeAreaProvider>);

import React from 'react';
import { createRoot } from 'react-dom/client';
import Board from '../../src/RequirementBoard';
import { SafeAreaProvider } from 'react-native-safe-area-context';

createRoot(document.getElementById('root')!).render(<SafeAreaProvider><Board cfg={{ serverUrl: location.origin, token: 'fixture', networkId: 'fixture-network' }} /></SafeAreaProvider>);

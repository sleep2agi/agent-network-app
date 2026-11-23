import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

// App.tsx unmounts ChatScreen on route exit (phone, two-pane, desktop and popout).
export function chatForeground() {
  if (Platform.OS === 'web') return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return AppState.currentState === 'active';
}
function subscribe(notify: () => void) {
  const sub = AppState.addEventListener('change', notify);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', notify);
  return () => {
    sub.remove();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', notify);
  };
}
export const useChatForeground = () => useSyncExternalStore(subscribe, chatForeground, () => false);

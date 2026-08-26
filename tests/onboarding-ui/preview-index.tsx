import { useMemo } from 'react';
import { registerRootComponent } from 'expo';
import { FirstRunScreen, LoginScreen } from '../../App';
import { setThemeMode } from '../../src/theme';

function Preview() {
  const query = useMemo(() => new URLSearchParams(globalThis.location?.search ?? ''), []);
  setThemeMode(query.get('theme') === 'light' ? 'light' : 'dark');
  const screen = query.get('screen') ?? 'first-run';

  if (screen === 'login') {
    return <LoginScreen onLogin={async () => undefined} />;
  }
  return (
    <FirstRunScreen
      busy={query.get('busy') === '1'}
      stage={query.get('busy') === '1' ? 'starting' : null}
      error={query.get('error') === '1' ? '本地服务暂时无法启动，请检查日志后重试。' : null}
      onStartLocal={async () => undefined}
      onRemote={() => undefined}
    />
  );
}

registerRootComponent(Preview);

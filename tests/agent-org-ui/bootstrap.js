// Preserve the real desktop Settings navigation contract in a single browser tab.
// The App still chooses its window URL and renders its complete SettingsScreen.
(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === 'plugin:window|get_all_windows' || command === 'plugin:webview|get_all_webviews') return [];
    if (command === 'plugin:webview|create_webview_window') {
      const target = new URL(args.options.url, location.origin);
      for (const key of ['theme', 'safeAreaSim', 'osFontScale', 'uiScaleSim']) {
        const value = new URLSearchParams(location.search).get(key);
        if (value !== null) target.searchParams.set(key, value);
      }
      location.assign(target.href);
      return null;
    }
    return original(command, args);
  };
})();

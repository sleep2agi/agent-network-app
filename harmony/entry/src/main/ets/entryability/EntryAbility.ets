import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { preferences } from '@kit.ArkData';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0000;
const TAG = 'ANetEntryAbility';

export default class EntryAbility extends UIAbility {
  private mainWindow: window.Window | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'setColorMode skipped: %{public}s', e.message);
    }
    const initialDark = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    AppStorage.setOrCreate<string>('anetThemeMode', initialDark ? 'dark' : 'light');
    try {
      const pref = preferences.getPreferencesSync(this.context, { name: 'anet_kv' });
      AppStorage.setOrCreate<preferences.Preferences>('anetKvStore', pref);
    } catch (err) {
      const e = err as BusinessError;
      hilog.error(DOMAIN, TAG, 'Failed to open preferences: %{public}s', e.message);
    }
    hilog.info(DOMAIN, TAG, 'Ability onCreate: %{public}s %{public}d', want.abilityName ?? '', launchParam.launchReason);
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    const isDark = newConfig.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    AppStorage.setOrCreate<string>('anetThemeMode', isDark ? 'dark' : 'light');
    if (this.mainWindow) {
      this.applySystemBarTheme(this.mainWindow, isDark);
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(DOMAIN, TAG, 'Ability onWindowStageCreate');
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'Failed to load content: %{public}s', err.message);
        return;
      }
      try {
        const win: window.Window = windowStage.getMainWindowSync();
        this.mainWindow = win;
        AppStorage.setOrCreate<window.Window>('anetMainWindow', win);
        win.setWindowLayoutFullScreen(true).catch((fullErr: BusinessError) => {
          hilog.warn(DOMAIN, TAG, 'setWindowLayoutFullScreen error: %{public}s', fullErr.message);
        });
        const isDark = AppStorage.get<string>('anetThemeMode') === 'dark';
        this.applySystemBarTheme(win, isDark);
        this.syncAvoidAreas(win);
        win.on('avoidAreaChange', () => {
          this.syncAvoidAreas(win);
        });
      } catch (winErr) {
        const e = winErr as BusinessError;
        hilog.error(DOMAIN, TAG, 'Window init failed: %{public}s', e.message);
      }
    });
  }

  private applySystemBarTheme(win: window.Window, isDark: boolean): void {
    try {
      const props: window.SystemBarProperties = {
        statusBarColor: '#00000000',
        statusBarContentColor: isDark ? '#FFFFFF' : '#1D2026',
        navigationBarColor: '#00000000',
        navigationBarContentColor: isDark ? '#FFFFFF' : '#1D2026',
      };
      win.setWindowSystemBarProperties(props).catch((barErr: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'setWindowSystemBarProperties failed: %{public}s', barErr.message);
      });
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'applySystemBarTheme threw: %{public}s', e.message);
    }
  }

  private syncAvoidAreas(win: window.Window): void {
    try {
      const sys = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const nav = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
      const cutout = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT);

      const topPx = Math.max(sys.topRect.height, cutout.topRect.height);
      const bottomPx = Math.max(sys.bottomRect.height, nav.bottomRect.height, cutout.bottomRect.height);
      const leftPx = Math.max(sys.leftRect.width, cutout.leftRect.width);
      const rightPx = Math.max(sys.rightRect.width, cutout.rightRect.width);

      const uiCtx = win.getUIContext();
      AppStorage.setOrCreate<number>('anetInsetTop', Math.round(uiCtx.px2vp(topPx)));
      AppStorage.setOrCreate<number>('anetInsetBottom', Math.round(uiCtx.px2vp(bottomPx)));
      AppStorage.setOrCreate<number>('anetInsetLeft', Math.round(uiCtx.px2vp(leftPx)));
      AppStorage.setOrCreate<number>('anetInsetRight', Math.round(uiCtx.px2vp(rightPx)));
    } catch (err) {
      const e = err as BusinessError;
      hilog.warn(DOMAIN, TAG, 'syncAvoidAreas failed: %{public}s', e.message);
    }
  }

  onWindowStageDestroy(): void {
    if (this.mainWindow) {
      try {
        this.mainWindow.off('avoidAreaChange');
      } catch {
        // ignore listener cleanup errors
      }
      this.mainWindow = null;
    }
  }
}

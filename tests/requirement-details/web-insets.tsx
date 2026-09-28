// Browser fixture: native safe areas are covered by the application's safe-area suite.
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
export const SafeAreaProvider = ({ children }: { children: React.ReactNode }) => children;

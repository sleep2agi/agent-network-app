import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

check('server module is labelled 服务器设置', source.includes("key: 'server', label: '服务器设置'"));
check('desktop main navigation excludes Settings', source.includes("TABS.filter(tab => tab.key !== 'settings')"));
check('desktop Settings has a dedicated bottom control', source.includes('desktopStyles.railSettings'));
check('Settings control is rendered after the main tabs', source.indexOf('{DESKTOP_MAIN_TABS.map') < source.indexOf('accessibilityLabel={DESKTOP_SETTINGS_TAB.label}'));
check('desktop rail uses the branded app icon', source.includes("source={require('./assets/icon.png')} style={desktopStyles.railBrandImage}"));
check('chat header settings opens the current node', source.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeDetail', alias: screen.alias })}"));
const detachedStart = source.indexOf('if (dedicatedChatWindow && cfg');
const workspaceStart = source.indexOf("if (desktop && cfg && screen.name !== 'login')");
const detachedBlock = source.slice(detachedStart, workspaceStart);
check('detached chat is selected before the full desktop workspace', detachedStart > 0 && detachedStart < workspaceStart);
check('detached chat renders only the chat screen', detachedBlock.includes('<ChatScreen') && !detachedBlock.includes('<DesktopWorkspace'));
check('detached chat has no back or node-settings controls', detachedBlock.includes('onBack={() => {}} desktop') && !detachedBlock.includes('onOpenNodeSettings'));

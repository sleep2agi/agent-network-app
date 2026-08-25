import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
const agents = fs.readFileSync(path.join(process.cwd(), 'src/AgentsScreen.tsx'), 'utf8');
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

check('server module is labelled 服务器设置', source.includes("key: 'server', label: '服务器设置'"));
check('desktop main navigation excludes Settings', source.includes("TABS.filter(tab => tab.key !== 'settings')"));
check('desktop Settings has a dedicated bottom control', source.includes('desktopStyles.railSettings'));
check('Settings control is rendered after the main tabs', source.indexOf('{DESKTOP_MAIN_TABS.map') < source.indexOf('accessibilityLabel={DESKTOP_SETTINGS_TAB.label}'));
check('desktop rail keeps the full branded icon in dark mode', source.includes("source={require('./assets/icon.png')} style={desktopStyles.railBrandImage}"));
check('desktop rail preserves the branded artwork in light mode', source.match(/source=\{require\('\.\/assets\/icon\.png'\)\}/g)?.length === 2 && source.includes('railBrandImageLight'));
check('chat header settings opens read-only info for the current node', source.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: screen.alias })}"));
const detachedStart = source.indexOf('if (dedicatedChatWindow && cfg');
const workspaceStart = source.indexOf("if (desktop && cfg && screen.name !== 'login')");
const detachedBlock = source.slice(detachedStart, workspaceStart);
check('detached chat is selected before the full desktop workspace', detachedStart > 0 && detachedStart < workspaceStart);
check('detached window never mounts the full workspace', detachedBlock.includes('<ChatScreen') && !detachedBlock.includes('<DesktopWorkspace'));
check('detached chat exposes settings for its exact alias', detachedBlock.includes("onOpenNodeSettings={() => setScreen({ name: 'nodeInfo', alias: detachedAlias })}"));
check('detached settings reuses the node detail screen', detachedBlock.includes('<NodeDetailScreen') && detachedBlock.includes('alias={detachedAlias}'));
check('detached settings returns to the same chat', detachedBlock.includes("onBack={() => setScreen({ name: 'chat', alias: detachedAlias })}"));
check('server workspace has a dedicated sidebar', source.includes('<ServerSidebar cfg={cfg}') && source.includes('serverSectionForScreen(screen)'));
check('server workspace exposes node inventory', source.includes("screen.name === 'serverNodes'") && source.includes("name: 'serverNodeDetail'"));
check('server workspace reuses the create-node flow', source.includes("section === 'create'") && source.includes("setScreen({ name: 'picker' })"));
check('desktop agent rows prevent browser text selection', agents.includes("userSelect: 'none'") && agents.includes('selectable={false}'));
check('desktop agent rows reserve long press for mobile', agents.includes('onLongPress={compact ? undefined'));
check('desktop agent rows retain left click and captured right-click menu', agents.includes('onPress={() => onOpenChat(item.alias)}') && agents.includes("addEventListener('contextmenu', handleContextMenu, true)"));
check('desktop agent hover highlights the row and avatar', agents.includes('onHoverIn={compact ?') && agents.includes('hoveredAlias === item.alias') && agents.includes('boxShadow:'));

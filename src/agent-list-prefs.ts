// Per-device agent list preferences: the two-pane list width (dragged divider) and which
// group headers are folded. Not per hub profile — both are about this screen, not an account.
//
// web (Tauri desktop and the web export): localStorage. Native: one small JSON file in
// documentDirectory (SecureStore is for secrets and is size-capped on Android; chat-pins.ts
// and storage.ts use the same directory for the same reason). Every read and write is
// best-effort: a preference we cannot store just lasts for this session.
import * as FileSystem from 'expo-file-system/legacy';
import { parseCollapsed } from './agents-list';
import { parseStoredListWidth } from './wide-layout';

export const LIST_WIDTH_KEY = 'agent_list_pane_width_v1';
export const COLLAPSED_KEY = 'agent_list_collapsed_v1';
const PREFS_FILE = () => `${FileSystem.documentDirectory}agent_list_prefs_v1.json`;

type Prefs = { [LIST_WIDTH_KEY]?: string; [COLLAPSED_KEY]?: string };

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

async function readNative(): Promise<Prefs> {
  try {
    if (!FileSystem.documentDirectory) return {};
    const info = await FileSystem.getInfoAsync(PREFS_FILE());
    if (!info.exists) return {};
    const v = JSON.parse(await FileSystem.readAsStringAsync(PREFS_FILE()));
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

// Writes are chained so two quick saves (width, then a fold) cannot interleave their
// read-modify-write and drop one of them.
let nativeWrite: Promise<unknown> = Promise.resolve();

async function readKey(key: keyof Prefs): Promise<string | null> {
  const ls = webStorage();
  if (ls) { try { return ls.getItem(key); } catch { return null; } }
  await nativeWrite;
  return (await readNative())[key] ?? null;
}

function writeKey(key: keyof Prefs, value: string): Promise<void> {
  const ls = webStorage();
  if (ls) { try { ls.setItem(key, value); } catch { /* session only */ } return Promise.resolve(); }
  const next = nativeWrite.then(async () => {
    if (!FileSystem.documentDirectory) return;
    const prefs = await readNative();
    prefs[key] = value;
    await FileSystem.writeAsStringAsync(PREFS_FILE(), JSON.stringify(prefs));
  }).catch(() => { /* session only */ });
  nativeWrite = next;
  return next;
}

/** null = never saved (use LIST_PANE_DEFAULT_WIDTH). */
export const loadListPaneWidth = async (): Promise<number | null> => parseStoredListWidth(await readKey(LIST_WIDTH_KEY));
export const saveListPaneWidth = (width: number): Promise<void> =>
  parseStoredListWidth(String(width)) === null ? Promise.resolve() : writeKey(LIST_WIDTH_KEY, String(Math.round(width)));

export const loadCollapsedGroups = async (): Promise<string[]> => parseCollapsed(await readKey(COLLAPSED_KEY));
export const saveCollapsedGroups = (titles: readonly string[]): Promise<void> => writeKey(COLLAPSED_KEY, JSON.stringify(parseCollapsed([...titles])));

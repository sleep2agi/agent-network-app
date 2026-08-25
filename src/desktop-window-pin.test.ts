import { applyStoredPinState, pinStorageKey, storedPinState, togglePinState } from './desktop-window-pin';

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
};
const calls: boolean[] = [];
const setAlwaysOnTop = async (value: boolean) => { calls.push(value); };

const mainKey = pinStorageKey('main');
const chatKey = pinStorageKey('chat-agent-a');
check('window labels produce separate persistence keys', mainKey !== chatKey);
check('unset windows start unpinned', storedPinState(storage, mainKey) === false);
const restoredOff = await applyStoredPinState(storage, mainKey, setAlwaysOnTop);
check('restore applies the persisted off state to the native window', restoredOff === false && calls.at(-1) === false);
const pinned = await togglePinState(false, storage, mainKey, setAlwaysOnTop);
check('toggle turns native always-on-top on', pinned === true && calls.at(-1) === true);
check('successful toggle is persisted', storedPinState(storage, mainKey) === true);
check('another window remains independent', storedPinState(storage, chatKey) === false);
const unpinned = await togglePinState(true, storage, mainKey, setAlwaysOnTop);
check('second toggle turns native always-on-top off', unpinned === false && calls.at(-1) === false);

values.set(mainKey, 'true');
const restoredOn = await applyStoredPinState(storage, mainKey, setAlwaysOnTop);
check('restart restores pinned state', restoredOn === true && calls.at(-1) === true);

let failedPersist = false;
try {
  await togglePinState(false, storage, chatKey, async () => { throw new Error('native failure'); });
} catch {
  failedPersist = storage.getItem(chatKey) !== null;
}
check('native failure is not persisted as success', failedPersist === false);

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`desktop window pin: ${checks.length} checks passed`);

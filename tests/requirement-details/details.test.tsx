import { afterEach, expect, mock, test } from 'bun:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
mock.module('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  Modal: ({ visible, children }: any) => visible ? children : null,
  StyleSheet: { create: (styles: any) => styles },
}));
mock.module('./src/ui-text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
mock.module('./src/safe-area-runtime', () => ({ useModalSafePadding: () => ({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }) }));
mock.module('./src/theme', () => ({ colors: {}, onThemeChange: () => () => {}, radius: { sm: 4, md: 8 }, spacing: { xs: 4, sm: 8, md: 12, lg: 16 } }));
mock.module('./src/requirements-store', () => ({ requirementsKey: (s: string) => s, readRequirements: () => [], writeRequirements: () => {} }));

const card = { id: 'r1', name: '验证需求详情', assignee: '负责人甲', priority: 'normal', due: '', column: 'pool', createdAt: '' };
let requests: any[] = [];
let reply: (value: any) => void;
let reject: (error: Error) => void;
class HubError extends Error { constructor(public status: number) { super('HTTP ' + status); } }
mock.module('./src/requirements-hub', () => ({
  listRequirements: async () => [{ ...card }], migrateLocalRequirements: async () => {}, createRequirementOnHub: async () => card,
  RequirementsHubError: HubError,
  moveRequirementOnHub: (cfg: any, id: string, column: string) => {
    requests.push({ network: cfg.networkId, id, column });
    return new Promise((resolve, fail) => { reply = resolve; reject = fail; });
  },
}));
const { default: Board } = await import('./src/RequirementBoard');
const { default: PeoplePicker } = await import('./src/RequirementPeoplePicker');
const cfg = { serverUrl: 'http://isolated.test', token: 'test', networkId: 'a' };
let renderer: ReactTestRenderer;
const byId = (id: string) => renderer.root.findByProps({ testID: id });
async function mount() { requests = []; await act(async () => { renderer = create(<Board cfg={cfg} />); }); }
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });

test('opening and closing details never writes; explicit move waits for Hub and prevents duplicates', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  expect(requests).toHaveLength(0);
  expect(byId('req-detail')).toBeTruthy();
  expect(byId('req-move-pool').props.disabled).toBe(true);
  await act(async () => { byId('req-move-doing').props.onPress(); byId('req-move-doing').props.onPress(); });
  expect(requests).toEqual([{ network: 'a', id: 'r1', column: 'doing' }]);
  expect(byId('req-move-done').props.disabled).toBe(true);
  await act(async () => reply({ ...card, column: 'doing' }));
  expect(byId('req-move-doing').props.accessibilityState.selected).toBe(true);
  await act(async () => byId('req-detail-close').props.onPress());
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

test('failed move preserves state and allows a retry', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-done').props.onPress());
  await act(async () => reject(new HubError(403)));
  expect(byId('req-move-pool').props.accessibilityState.selected).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('你没有修改这条需求的权限');
  await act(async () => byId('req-move-doing').props.onPress());
  expect(requests).toHaveLength(2);
  await act(async () => reply({ ...card, column: 'doing' }));
});

test('switching network closes old details and ignores its late mutation response', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-done').props.onPress());
  await act(async () => renderer.update(<Board cfg={{ ...cfg, networkId: 'b' }} />));
  expect(renderer.root.findAllByProps({ testID: 'req-detail' })).toHaveLength(0);
  await act(async () => reply({ ...card, name: '旧网络回复', column: 'done' }));
  expect(JSON.stringify(renderer.toJSON())).not.toContain('旧网络回复');
});

test('people picker separates identical user/node names, stages selection, and confirms stable references', async () => {
  const people = [
    { kind: 'user' as const, id: 'same', name: '同名', networkId: 'a' },
    { kind: 'node' as const, id: 'same', name: '同名', networkId: 'a' },
    { kind: 'node' as const, id: 'foreign', name: '其他网络', networkId: 'b' },
  ];
  const saved: any[] = [];
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="participants" people={people} selected={[]} onConfirm={value => saved.push(value)} onClose={() => {}} />); });
  expect(renderer.root.findAllByProps({ testID: 'person-node:foreign' })).toHaveLength(0);
  await act(async () => byId('person-user:same').props.onPress());
  await act(async () => byId('person-node:same').props.onPress());
  expect(saved).toHaveLength(0);
  await act(async () => byId('people-confirm').props.onPress());
  expect(saved).toEqual([[{ kind: 'user', id: 'same' }, { kind: 'node', id: 'same' }]]);
});

test('owner picker replaces owner and cancellation never persists', async () => {
  let closed = 0;
  let saved = 0;
  const people = [{ kind: 'user' as const, id: 'u', name: '人', networkId: 'a' }, { kind: 'node' as const, id: 'n', name: 'Agent', networkId: 'a' }];
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="owner" people={people} selected={[people[0]]} onConfirm={() => saved++} onClose={() => closed++} />); });
  await act(async () => byId('person-node:n').props.onPress());
  expect(byId('person-user:u').props.accessibilityState.checked).toBe(false);
  expect(byId('person-node:n').props.accessibilityState.checked).toBe(true);
  await act(async () => byId('people-cancel').props.onPress());
  expect(saved).toBe(0);
  expect(closed).toBe(1);
});

test('removed members cannot be silently saved', async () => {
  let saved = 0;
  await act(async () => { renderer = create(<PeoplePicker networkId="a" mode="owner" people={[]} selected={[{ kind: 'user', id: 'gone' }]} onConfirm={() => saved++} onClose={() => {}} />); });
  expect(byId('people-confirm').props.disabled).toBe(true);
  await act(async () => byId('people-confirm').props.onPress());
  expect(saved).toBe(0);
});

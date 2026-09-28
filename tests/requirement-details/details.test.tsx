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
mock.module('./src/theme', () => ({ colors: {}, radius: { sm: 4, md: 8 }, spacing: { xs: 4, sm: 8, md: 12, lg: 16 } }));
mock.module('./src/requirements-store', () => ({ requirementsKey: (s: string) => s, readRequirements: () => [], writeRequirements: () => {} }));

const card = { id: 'r1', name: '验证需求详情', assignee: '负责人甲', priority: 'normal', due: '', column: 'pool', createdAt: '' };
let requests: any[] = [];
let reply: (value: any) => void;
let reject: (error: Error) => void;
class HubError extends Error { constructor(public status: number) { super('HTTP ' + status); } }
mock.module('./src/requirements-hub', () => ({
  listRequirements: async () => [{ ...card }, { ...card, id: 'r2', name: '另一个需求' }], migrateLocalRequirements: async () => {}, createRequirementOnHub: async () => card,
  RequirementsHubError: HubError,
  moveRequirementOnHub: (cfg: any, id: string, column: string) => {
    requests.push({ network: cfg.networkId, id, column });
    return new Promise((resolve, fail) => { reply = resolve; reject = fail; });
  },
}));
const { default: Board } = await import('./src/RequirementBoard');
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

test('late failure belongs to the original card, not newly opened details', async () => {
  await mount();
  await act(async () => byId('req-card-r1').props.onPress());
  await act(async () => byId('req-move-doing').props.onPress());
  await act(async () => byId('req-detail-close').props.onPress());
  await act(async () => byId('req-card-r2').props.onPress());
  await act(async () => reject(new HubError(403)));
  expect(JSON.stringify(renderer.toJSON())).not.toContain('你没有修改这条需求的权限');
  await act(async () => byId('req-detail-close').props.onPress());
  await act(async () => byId('req-card-r1').props.onPress());
  expect(JSON.stringify(renderer.toJSON())).toContain('你没有修改这条需求的权限');
});

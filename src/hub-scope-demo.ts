// Hub 侧栏（SKILLS / 令牌 / 环境变量 / Provider）的演示数据。
// Hub 这些写接口还没接通。这里只在内存里走，不 import api / app-fetch，不发请求。
// 密钥、令牌值、环境变量的值都不会出现在成功结果里。
// 三层环境变量（Hub / Daemon / 节点，#909）不是这一层：环境变量页只演示 Hub 这一层。

import {
  blockDemoNet,
  inferDemoProviderProtocol,
  simulateEnvSave,
  simulateProviderProbe,
  simulateProviderUpsert,
  simulateSecretSave,
  type DemoNet,
  type DemoProviderProtocol,
  type ProbeResult,
} from './backend-pending-demo';

const NO_NET = { network: false as const, persisted: false as const };

export type HubSection = 'skills' | 'tokens' | 'env' | 'providers';

export type HubScreen = 'hubSkills' | 'hubTokens' | 'hubEnv' | 'hubProviders';

export const HUB_NAV: readonly { section: HubSection; screen: HubScreen; labelKey: string }[] = [
  { section: 'skills', screen: 'hubSkills', labelKey: 'server.hub.skills' },
  { section: 'tokens', screen: 'hubTokens', labelKey: 'server.hub.tokens' },
  { section: 'env', screen: 'hubEnv', labelKey: 'server.hub.env' },
  { section: 'providers', screen: 'hubProviders', labelKey: 'server.hub.providers' },
];

export function isHubSection(section: string): section is HubSection {
  return HUB_NAV.some(item => item.section === section);
}

/** `?fixture=hub-scope&section=skills|tokens|env|providers&theme=dark|light` */
export function parseHubScopeFixture(search: string): { theme: 'dark' | 'light'; section: HubSection } | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('fixture') !== 'hub-scope') return null;
  const theme = params.get('theme') === 'light' ? 'light' : 'dark';
  const raw = params.get('section') ?? 'skills';
  const section: HubSection = isHubSection(raw) ? raw : 'skills';
  return { theme, section };
}

export function screenForHubSection(section: HubSection): HubScreen {
  return HUB_NAV.find(item => item.section === section)!.screen;
}

export function hubSectionForScreen(name: string): HubSection | null {
  return HUB_NAV.find(item => item.screen === name)?.section ?? null;
}

function leaked(result: unknown, secrets: readonly string[]): boolean {
  const raw = JSON.stringify(result);
  return secrets.some(secret => secret.length >= 8 && raw.includes(secret));
}

export interface HubSkill {
  id: string;
  titleKey: string;
  summaryKey: string;
  bodyKey: string;
  enabled: boolean;
}

const SKILL_SEED: readonly HubSkill[] = [
  { id: 'hub-summarize', titleKey: 'hubScope.skill.summarize.title', summaryKey: 'hubScope.skill.summarize.summary', bodyKey: 'hubScope.skill.summarize.body', enabled: true },
  { id: 'hub-review', titleKey: 'hubScope.skill.review.title', summaryKey: 'hubScope.skill.review.summary', bodyKey: 'hubScope.skill.review.body', enabled: true },
  { id: 'hub-release', titleKey: 'hubScope.skill.release.title', summaryKey: 'hubScope.skill.release.summary', bodyKey: 'hubScope.skill.release.body', enabled: false },
  { id: 'hub-triage', titleKey: 'hubScope.skill.triage.title', summaryKey: 'hubScope.skill.triage.summary', bodyKey: 'hubScope.skill.triage.body', enabled: true },
];

export function hubSkillSeed(): HubSkill[] {
  return SKILL_SEED.map(row => ({ ...row }));
}

export type HubSkillToggleResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'missing' })
  | ({ ok: true } & typeof NO_NET & { rows: HubSkill[]; id: string; enabled: boolean });

export function toggleHubSkill(rows: readonly HubSkill[], id: string, net?: DemoNet): HubSkillToggleResult {
  blockDemoNet(net);
  const found = rows.find(row => row.id === id);
  if (!found) return { ok: false, ...NO_NET, reason: 'missing' };
  const enabled = !found.enabled;
  return {
    ok: true,
    ...NO_NET,
    id,
    enabled,
    rows: rows.map(row => (row.id === id ? { ...row, enabled } : { ...row })),
  };
}

export type HubSkillOpenResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'missing' })
  | ({ ok: true } & typeof NO_NET & { id: string; titleKey: string; summaryKey: string; bodyKey: string; enabled: boolean });

export function openHubSkill(rows: readonly HubSkill[], id: string, net?: DemoNet): HubSkillOpenResult {
  blockDemoNet(net);
  const found = rows.find(row => row.id === id);
  if (!found) return { ok: false, ...NO_NET, reason: 'missing' };
  return { ok: true, ...NO_NET, id: found.id, titleKey: found.titleKey, summaryKey: found.summaryKey, bodyKey: found.bodyKey, enabled: found.enabled };
}

export interface HubToken {
  name: string;
  hintKey: string;
  status: 'set';
}

const TOKEN_SEED: readonly HubToken[] = [
  { name: 'hub-outbound', hintKey: 'hubScope.token.hint.outbound', status: 'set' },
  { name: 'webhook-sign', hintKey: 'hubScope.token.hint.webhook', status: 'set' },
  { name: 'mirror-read', hintKey: 'hubScope.token.hint.mirror', status: 'set' },
];

export function hubTokenSeed(): HubToken[] {
  return TOKEN_SEED.map(row => ({ ...row }));
}

export type HubTokenSaveResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'name' | 'value' | 'duplicate' | 'hidden' })
  | ({ ok: true } & typeof NO_NET & { rows: HubToken[]; name: string; echoed: false });

export function saveHubToken(rows: readonly HubToken[], input: { name: string; value: string }, net?: DemoNet): HubTokenSaveResult {
  const saved = simulateSecretSave(input, net);
  if (!saved.ok) return { ok: false, ...NO_NET, reason: saved.reason };
  if (rows.some(row => row.name === saved.name)) return { ok: false, ...NO_NET, reason: 'duplicate' };
  const next = [
    ...rows.map(row => ({ name: row.name, hintKey: row.hintKey, status: 'set' as const })),
    { name: saved.name, hintKey: 'hubScope.token.hint.custom', status: 'set' as const },
  ];
  const result = { ok: true as const, ...NO_NET, rows: next, name: saved.name, echoed: false as const };
  if (leaked(result, [input.value])) return { ok: false, ...NO_NET, reason: 'hidden' };
  return result;
}

export interface HubEnvVar {
  key: string;
  status: 'set';
}

const ENV_SEED: readonly HubEnvVar[] = [
  { key: 'ANET_REGION', status: 'set' },
  { key: 'ANET_LOG_LEVEL', status: 'set' },
  { key: 'HTTPS_PROXY', status: 'set' },
];

export function hubEnvSeed(): HubEnvVar[] {
  return ENV_SEED.map(row => ({ ...row }));
}

export type HubEnvSaveResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'key' | 'value' | 'duplicate' | 'hidden' })
  | ({ ok: true } & typeof NO_NET & { rows: HubEnvVar[]; key: string; echoed: false });

export function saveHubEnv(rows: readonly HubEnvVar[], input: { key: string; value: string }, net?: DemoNet): HubEnvSaveResult {
  const saved = simulateEnvSave(input, net);
  if (!saved.ok) return { ok: false, ...NO_NET, reason: saved.reason };
  if (rows.some(row => row.key === saved.key)) return { ok: false, ...NO_NET, reason: 'duplicate' };
  const next = [
    ...rows.map(row => ({ key: row.key, status: 'set' as const })),
    { key: saved.key, status: 'set' as const },
  ];
  const result = { ok: true as const, ...NO_NET, rows: next, key: saved.key, echoed: false as const };
  if (leaked(result, [input.value])) return { ok: false, ...NO_NET, reason: 'hidden' };
  return result;
}

export interface HubProvider {
  id: string;
  baseUrl: string;
  model: string;
  protocol: DemoProviderProtocol;
  credential: 'entered' | 'none';
}

const PROVIDER_SEED: readonly HubProvider[] = [
  { id: 'demo-deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', protocol: 'openai-chat-completions', credential: 'entered' },
  { id: 'demo-minimax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01', protocol: 'openai-chat-completions', credential: 'entered' },
  { id: 'demo-compat', baseUrl: 'https://api.example.com/v1', model: 'demo-model', protocol: 'openai-chat-completions', credential: 'none' },
];

export function hubProviderSeed(): HubProvider[] {
  return PROVIDER_SEED.map(row => ({ ...row }));
}

export type HubProviderSaveResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'id' | 'base_url' | 'model' | 'secret' | 'hidden' })
  | ({ ok: true } & typeof NO_NET & { rows: HubProvider[]; id: string; credential: 'entered' | 'none'; echoed: false });

export function saveHubProvider(
  rows: readonly HubProvider[],
  input: { id: string; baseUrl: string; model: string; apiKey: string },
  net?: DemoNet,
): HubProviderSaveResult {
  const protocol = inferDemoProviderProtocol(input.baseUrl);
  const saved = simulateProviderUpsert(
    rows.map(row => ({ id: row.id, baseUrl: row.baseUrl, model: row.model, protocol: row.protocol })),
    { ...input, protocol },
    net,
  );
  if (!saved.ok) return { ok: false, ...NO_NET, reason: saved.reason };
  const next = saved.rows.map(row => {
    const prev = rows.find(item => item.id === row.id);
    const credential = row.id === saved.id ? saved.credential : (prev?.credential ?? 'none');
    return { id: row.id, baseUrl: row.baseUrl, model: row.model, protocol: row.protocol, credential };
  });
  const result = { ok: true as const, ...NO_NET, rows: next, id: saved.id, credential: saved.credential, echoed: false as const };
  if (leaked(result, [input.apiKey])) return { ok: false, ...NO_NET, reason: 'hidden' };
  return result;
}

export function probeHubProvider(input: { providerId: string; model: string; protocol?: DemoProviderProtocol }, net?: DemoNet): ProbeResult {
  return simulateProviderProbe(input, net);
}

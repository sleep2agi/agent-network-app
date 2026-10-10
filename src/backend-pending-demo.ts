// 前端壳：Provider 保存、Probe、Daemon 的供应商 / 技能 / 密钥 / 环境变量。
// 这些入口的 Hub / Daemon 还没接通。这里只在内存里走演示，替换点见 BACKEND_PENDING_ENTRIES。
//
// 隔离：不 import api / app-fetch，不读文件系统，不调用 net。
// 成功结果只含白名单字段。密钥、环境变量的值、以及任何带上密钥原文的结果都不会返回。

import {
  presetLabelKey,
  providerLocalIssues,
  validateApiKey,
  validateBaseUrl,
  type ProviderChoice,
  type ProviderIssue,
} from './provider-create-options';

/** 测试注入。演示函数只会把它丢掉，不会调用。 */
export type DemoNet = () => void;

export function blockDemoNet(net: DemoNet | undefined): void {
  void net;
}

export interface BackendPendingEntry {
  id: 'provider-save' | 'provider-probe' | 'daemon-providers' | 'daemon-skills' | 'daemon-secrets' | 'daemon-env';
  /** 现在画在哪。接通后改这一处调用。 */
  surface: string;
  /** 接通后用哪一个真实调用换掉哪一个演示函数。 */
  replaceWith: string;
}

export const BACKEND_PENDING_ENTRIES: readonly BackendPendingEntry[] = [
  {
    id: 'provider-save',
    surface: 'Codex provider form (create-wizard runtime step, node model section) and create confirm',
    replaceWith: 'simulateProviderSave → set_network_secret + node_spec.provider',
  },
  {
    id: 'provider-probe',
    surface: 'Provider demo card and the daemon management page demo',
    replaceWith: 'simulateProviderProbe → Hub tool probe_provider_model',
  },
  {
    id: 'daemon-providers',
    surface: 'Daemon management page demo',
    replaceWith: 'simulateProviderUpsert → daemon provider config write',
  },
  {
    id: 'daemon-skills',
    surface: 'Daemon management page demo',
    replaceWith: 'simulateSkillOpen → daemon skills management',
  },
  {
    id: 'daemon-secrets',
    surface: 'Daemon management page demo',
    replaceWith: 'simulateSecretSave → vault write',
  },
  {
    id: 'daemon-env',
    surface: 'Daemon management page demo',
    replaceWith: 'simulateEnvSave → daemon env write',
  },
];

const NO_NET = { network: false as const, persisted: false as const };

export type DemoIssue = ProviderIssue | 'none' | 'secret';

export interface ProviderSaveInput {
  runtimeId: string;
  choice: ProviderChoice;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type ProviderSaveResult =
  | ({ ok: false } & typeof NO_NET & { issue: DemoIssue })
  | ({ ok: true } & typeof NO_NET & {
    preset: Exclude<ProviderChoice, 'none'>;
    presetKey: string;
    model: string;
    credential: 'entered';
  });

export type ProbeResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'provider' | 'model' | 'secret' })
  | ({ ok: true } & typeof NO_NET & { providerId: string; model: string; protocol: DemoProviderProtocol; reachable: true; latencyMs: 128 });

export type DemoProviderProtocol = 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses';

export function inferDemoProviderProtocol(baseUrl: string): DemoProviderProtocol {
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
    if (hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com')) return 'anthropic-messages';
  } catch {
    // Empty / incomplete demo URLs use the common OpenAI-compatible default.
  }
  return 'openai-chat-completions';
}

export interface DemoProviderRow {
  id: string;
  baseUrl: string;
  model: string;
  protocol: DemoProviderProtocol;
}

export const DEMO_PROVIDER_SEED: readonly DemoProviderRow[] = [
  { id: 'demo-deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', protocol: 'openai-chat-completions' },
];

export function demoProviderSeed(): DemoProviderRow[] {
  return DEMO_PROVIDER_SEED.map(row => ({ ...row }));
}

export type ProviderUpsertResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'id' | 'base_url' | 'model' | 'secret' })
  | ({ ok: true } & typeof NO_NET & { rows: DemoProviderRow[]; id: string; credential: 'entered' | 'none' });

export const DEMO_SKILLS = [
  { id: 'demo-summarize', titleKey: 'backendPending.skill.summarize.title', bodyKey: 'backendPending.skill.summarize.body' },
  { id: 'demo-review', titleKey: 'backendPending.skill.review.title', bodyKey: 'backendPending.skill.review.body' },
] as const;

export type DemoSkillId = (typeof DEMO_SKILLS)[number]['id'];

export type SkillOpenResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'missing' })
  | ({ ok: true } & typeof NO_NET & { id: DemoSkillId; titleKey: string; bodyKey: string });

export type SecretSaveResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'name' | 'value' })
  | ({ ok: true } & typeof NO_NET & { name: string; echoed: false });

export type EnvSaveResult =
  | ({ ok: false } & typeof NO_NET & { reason: 'key' | 'value' })
  | ({ ok: true } & typeof NO_NET & { key: string; echoed: false });

function secretShaped(value: string): boolean {
  if (/sk-|api[_-]?key|secret|token|bearer|passwd|password/i.test(value)) return true;
  if (value.length > 48) return true;
  // 一长串没有分隔符的字母数字更像密钥，不像供应商 id 或模型 id。
  return /^[A-Za-z0-9]{24,}$/.test(value);
}

/** 结果 JSON 里一旦出现调用方传来的密钥原文，调用方必须改回一条不含原文的失败。 */
function echoesSecret(result: unknown, secrets: readonly string[]): boolean {
  const raw = JSON.stringify(result);
  return secrets.some(secret => secret.length >= 8 && raw.includes(secret));
}

export function simulateProviderSave(input: ProviderSaveInput, transportOk = true, net?: DemoNet): ProviderSaveResult {
  blockDemoNet(net);
  if (input.choice === 'none') return { ok: false, ...NO_NET, issue: 'none' };
  const issues = providerLocalIssues(input, transportOk);
  if (issues.length) return { ok: false, ...NO_NET, issue: issues[0] };
  const model = input.model.trim();
  const saved = {
    ok: true as const,
    ...NO_NET,
    preset: input.choice,
    presetKey: presetLabelKey(input.choice),
    model,
    credential: 'entered' as const,
  };
  if (echoesSecret(saved, [input.apiKey])) return { ok: false, ...NO_NET, issue: 'secret' };
  return saved;
}

const PROBE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const PROBE_MODEL = /^[A-Za-z0-9_.:/-]{1,80}$/;

export function simulateProviderProbe(input: { providerId: string; model: string; protocol?: DemoProviderProtocol }, net?: DemoNet): ProbeResult {
  blockDemoNet(net);
  const providerId = input.providerId.trim();
  const model = input.model.trim();
  if (secretShaped(providerId) || secretShaped(model)) return { ok: false, ...NO_NET, reason: 'secret' };
  if (!PROBE_ID.test(providerId)) return { ok: false, ...NO_NET, reason: 'provider' };
  if (!PROBE_MODEL.test(model) || /\s/.test(model)) return { ok: false, ...NO_NET, reason: 'model' };
  return {
    ok: true as const,
    ...NO_NET,
    providerId,
    model,
    protocol: input.protocol ?? 'openai-chat-completions',
    reachable: true as const,
    latencyMs: 128 as const,
  };
}

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,32}$/;
const PLAIN_MODEL = /^[A-Za-z0-9_.:-]{1,80}$/;

export function simulateProviderUpsert(
  rows: readonly DemoProviderRow[],
  input: { id: string; baseUrl: string; model: string; apiKey: string; protocol: DemoProviderProtocol },
  net?: DemoNet,
): ProviderUpsertResult {
  blockDemoNet(net);
  const id = input.id.trim();
  const model = input.model.trim();
  if (secretShaped(id) || secretShaped(model) || secretShaped(input.baseUrl)) return { ok: false, ...NO_NET, reason: 'secret' };
  if (!PROVIDER_ID.test(id)) return { ok: false, ...NO_NET, reason: 'id' };
  const base = validateBaseUrl(input.baseUrl);
  if (!base.ok) return { ok: false, ...NO_NET, reason: 'base_url' };
  if (!PLAIN_MODEL.test(model)) return { ok: false, ...NO_NET, reason: 'model' };
  const key = validateApiKey(input.apiKey);
  if (key === 'invalid' || key === 'too_long') return { ok: false, ...NO_NET, reason: 'secret' };
  const next = rows
    .filter(row => row.id !== id)
    .map(row => ({ id: row.id, baseUrl: row.baseUrl, model: row.model, protocol: row.protocol }));
  next.push({ id, baseUrl: base.url, model, protocol: input.protocol });
  next.sort((a, b) => a.id.localeCompare(b.id));
  const saved = {
    ok: true as const,
    ...NO_NET,
    rows: next,
    id,
    credential: key === 'ok' ? 'entered' as const : 'none' as const,
  };
  if (echoesSecret(saved, [input.apiKey])) return { ok: false, ...NO_NET, reason: 'secret' };
  return saved;
}

export function simulateSkillOpen(id: string, net?: DemoNet): SkillOpenResult {
  blockDemoNet(net);
  const skill = DEMO_SKILLS.find(row => row.id === id);
  if (!skill) return { ok: false, ...NO_NET, reason: 'missing' };
  return { ok: true, ...NO_NET, id: skill.id, titleKey: skill.titleKey, bodyKey: skill.bodyKey };
}

const SECRET_NAME = /^[a-z][a-z0-9_-]{0,32}$/;

export function simulateSecretSave(input: { name: string; value: string }, net?: DemoNet): SecretSaveResult {
  blockDemoNet(net);
  const name = input.name.trim();
  if (!SECRET_NAME.test(name) || secretShaped(name)) return { ok: false, ...NO_NET, reason: 'name' };
  if (validateApiKey(input.value) !== 'ok') return { ok: false, ...NO_NET, reason: 'value' };
  const saved = { ok: true as const, ...NO_NET, name, echoed: false as const };
  if (echoesSecret(saved, [input.value])) return { ok: false, ...NO_NET, reason: 'value' };
  return saved;
}

const ENV_KEY = /^[A-Z][A-Z0-9_]{0,32}$/;

export function simulateEnvSave(input: { key: string; value: string }, net?: DemoNet): EnvSaveResult {
  blockDemoNet(net);
  const key = input.key.trim();
  if (!ENV_KEY.test(key)) return { ok: false, ...NO_NET, reason: 'key' };
  if (typeof input.value !== 'string' || input.value.length === 0 || input.value.length > 4096 || /[\r\n\0]/.test(input.value)) {
    return { ok: false, ...NO_NET, reason: 'value' };
  }
  const saved = { ok: true as const, ...NO_NET, key, echoed: false as const };
  if (echoesSecret(saved, [input.value])) return { ok: false, ...NO_NET, reason: 'value' };
  return saved;
}

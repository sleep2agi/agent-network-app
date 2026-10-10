// Codex model_providers 与 OpenCode 原生供应商的创建选项。纯函数,不 import react-native。
//
// 本版是前端壳:按 runtime 决定画哪一块,本地校验,不把密钥放进创建请求。
// Hub 密钥库尚未接通。选了 Codex 供应商时提交会被拦住并提示升级 Hub,
// 不会改发一份不带密钥的 node_spec。
//
// proposed Hub contract: node_spec.provider = { preset, base_url?, model, secret_ref? }
// and key sent via the vault endpoint, never inside logs.
//
// 目录按 runtime 分开,没有一张所有 runtime 共用的总表:
//   codex-app-server / codex-sdk → Codex 自己的 model_providers 预设
//   opencode-cli + V2 → 不在这张表里;界面只引导 OpenCode 自己的 provider/model 与 auth
//   其它 runtime(含 OpenCode V1、Claude)→ 不出现供应商区块,创建请求与今天相同
// 选择供应商不会打开 OpenCode 的本地工具授权。

export const CODEX_RUNTIMES = ['codex-app-server', 'codex-sdk'] as const;
export type CodexRuntimeId = (typeof CODEX_RUNTIMES)[number];

export const CODEX_PROVIDER_PRESETS = ['deepseek', 'minimax', 'custom-openai-compat'] as const;
export type CodexProviderPreset = (typeof CODEX_PROVIDER_PRESETS)[number];
export type ProviderChoice = 'none' | CodexProviderPreset;

/** 每个 Codex runtime 一份预设。OpenCode / Claude 不在这里。 */
export const RUNTIME_PROVIDER_PRESETS: Readonly<Record<CodexRuntimeId, readonly CodexProviderPreset[]>> = {
  'codex-app-server': CODEX_PROVIDER_PRESETS,
  'codex-sdk': CODEX_PROVIDER_PRESETS,
};

export const API_KEY_MAX_LENGTH = 4096;

/**
 * proposed Hub contract: node_spec.provider = { preset, base_url?, model, secret_ref? }
 * and key sent via the vault endpoint, never inside logs.
 * 这一版的向导不发送该对象:没有密钥库时附上它就等于丢掉密钥。
 */
export const NODE_SPEC_PROVIDER_CONTRACT = {
  nodeSpecField: 'provider',
  fields: ['preset', 'base_url', 'model', 'secret_ref'] as const,
  vaultSetTool: 'set_network_secret',
  vaultListTool: 'list_network_secrets',
} as const;

export interface NodeSpecProvider {
  preset: CodexProviderPreset;
  base_url?: string;
  model: string;
  secret_ref?: string;
}

export interface ProviderFormValue {
  choice: ProviderChoice;
  baseUrl: string;
  model: string;
  /** 只在这次表单的内存里。快照、请求体和错误字符串都不得带上它。 */
  apiKey: string;
  secretRef: string | null;
}

export const EMPTY_PROVIDER_FORM: ProviderFormValue = {
  choice: 'none',
  baseUrl: '',
  model: '',
  apiKey: '',
  secretRef: null,
};

export const CODEX_PRESET_BASE_URLS: Readonly<Record<CodexProviderPreset, string>> = {
  deepseek: 'https://api.deepseek.com/v1',
  minimax: 'https://api.minimaxi.com/v1',
  'custom-openai-compat': '',
};

/** Codex model_providers 用普通模型 id,不是 OpenCode 的 provider/model。 */
export const CODEX_PRESET_MODELS: Readonly<Record<CodexProviderPreset, readonly string[]>> = {
  deepseek: ['deepseek-v4-pro', 'deepseek-chat'],
  minimax: ['MiniMax-M3'],
  'custom-openai-compat': [],
};

export type ProviderSurface =
  | { kind: 'hidden' }
  | { kind: 'opencode-native' }
  | { kind: 'codex'; runtimeId: CodexRuntimeId; presets: readonly CodexProviderPreset[] };

export type ProviderIssue =
  | 'base_url_required'
  | 'base_url_invalid'
  | 'api_key_required'
  | 'api_key_invalid'
  | 'api_key_too_long'
  | 'model_invalid_plain'
  | 'preset_not_for_runtime'
  | 'hub_not_ready'
  | 'unsupported_hub'
  | 'insecure_transport';

export const PROVIDER_ISSUE_ZH: Readonly<Record<ProviderIssue, string>> = {
  base_url_required: '请填写 Codex model_providers 的 base_url。',
  base_url_invalid: 'base_url 只能是 https://，或本机回环上的 http://。',
  api_key_required: '请填写 API 密钥。',
  api_key_invalid: 'API 密钥不能包含换行或空字符。',
  api_key_too_long: `API 密钥过长（最多 ${API_KEY_MAX_LENGTH} 个字符）。`,
  model_invalid_plain: 'Codex 的模型是普通 id，不能包含斜杠或空白。',
  preset_not_for_runtime: '这个 runtime 不能使用该供应商预设。',
  hub_not_ready: '需升级 Hub 后才能保存供应商密钥。这一版不会把密钥发出去，也不会在没有密钥的情况下创建节点。',
  unsupported_hub: '目标 Hub 还不支持 provider 字段。需升级 Hub；不会丢弃已填写的密钥，也不会改成不带密钥的创建。',
  insecure_transport: '当前 Hub 地址是明文 http（不是本机回环）。密钥不会通过这条连接发送。',
};

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

export function isCodexRuntime(runtimeId: string | null | undefined): runtimeId is CodexRuntimeId {
  return runtimeId === 'codex-app-server' || runtimeId === 'codex-sdk';
}

export function isCodexPreset(value: string): value is CodexProviderPreset {
  return (CODEX_PROVIDER_PRESETS as readonly string[]).includes(value);
}

/** 该 runtime 的 Codex 预设。不是 Codex 则为空,调用方不要改画成别的 runtime 的表。 */
export function presetsFor(runtimeId: string | null | undefined): readonly CodexProviderPreset[] {
  if (!isCodexRuntime(runtimeId)) return [];
  return RUNTIME_PROVIDER_PRESETS[runtimeId];
}

/**
 * 向导画什么。OpenCode 只有 V2 才出现引导,而且 kind 不是 codex。
 * generation 仅对 opencode-cli 有意义。
 */
export function providerSurface(runtimeId: string, opencodeGeneration?: 'v1' | 'v2'): ProviderSurface {
  if (isCodexRuntime(runtimeId)) return { kind: 'codex', runtimeId, presets: presetsFor(runtimeId) };
  if (runtimeId === 'opencode-cli' && opencodeGeneration === 'v2') return { kind: 'opencode-native' };
  return { kind: 'hidden' };
}

export function suggestedProviderModels(runtimeId: string, preset: CodexProviderPreset): readonly string[] {
  if (!presetsFor(runtimeId).includes(preset)) return [];
  return CODEX_PRESET_MODELS[preset];
}

export function formAfterChoice(current: ProviderFormValue, choice: ProviderChoice, runtimeId: string): ProviderFormValue {
  if (choice === 'none') return { ...EMPTY_PROVIDER_FORM };
  if (!presetsFor(runtimeId).includes(choice)) return { ...EMPTY_PROVIDER_FORM };
  if (choice === current.choice) return current;
  const models = suggestedProviderModels(runtimeId, choice);
  return {
    choice,
    baseUrl: CODEX_PRESET_BASE_URLS[choice],
    model: models[0] ?? '',
    apiKey: '',
    secretRef: null,
  };
}

export function reconcileProviderForm(
  prevRuntimeId: string,
  nextRuntimeId: string,
  form: ProviderFormValue,
): { form: ProviderFormValue; cleared: boolean } {
  if (prevRuntimeId === nextRuntimeId) return { form, cleared: false };
  const prev = presetsFor(prevRuntimeId);
  const next = presetsFor(nextRuntimeId);
  const sameCatalog = prev.length > 0 && next.length > 0 && prev.every((preset, i) => preset === next[i]) && prev.length === next.length;
  if (sameCatalog) return { form, cleared: false };
  const dirty = form.choice !== 'none' || form.apiKey.length > 0 || form.baseUrl.length > 0 || form.model.length > 0 || !!form.secretRef;
  if (!dirty) return { form, cleared: false };
  return { form: { ...EMPTY_PROVIDER_FORM }, cleared: true };
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || LOOPBACK_V4.test(host);
}

export function hubTransportAllowsSecrets(serverUrl: string): boolean {
  let url: URL;
  try { url = new URL(serverUrl); } catch { return false; }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

export function validateBaseUrl(raw: string): { ok: true; url: string } | { ok: false } {
  const s = raw.trim();
  if (!s) return { ok: false };
  let url: URL;
  try { url = new URL(s); } catch { return { ok: false }; }
  if (url.username || url.password) return { ok: false };
  if (url.protocol === 'https:') return { ok: true, url: url.toString() };
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return { ok: true, url: url.toString() };
  return { ok: false };
}

export function validateApiKey(raw: string): 'ok' | 'empty' | 'invalid' | 'too_long' {
  if (typeof raw !== 'string' || raw.length === 0) return 'empty';
  if (raw.length > API_KEY_MAX_LENGTH) return 'too_long';
  if (/[\r\n\0]/.test(raw)) return 'invalid';
  return 'ok';
}

export function validateCodexModel(raw: string): ProviderIssue | null {
  const model = (raw ?? '').trim();
  if (!model || /\s/.test(model) || model.length > 100 || model.includes('/') || !/^[A-Za-z0-9_.:-]+$/.test(model)) {
    return 'model_invalid_plain';
  }
  return null;
}

export interface ProviderCheckInput {
  runtimeId: string;
  choice: ProviderChoice;
  baseUrl: string;
  model: string;
  apiKey: string;
  secretRef?: string | null;
}

/** 字段是否填对。choice=none 时为空。不管 Hub 能不能收下。 */
export function providerLocalIssues(input: ProviderCheckInput, transportOk = true): ProviderIssue[] {
  if (input.choice === 'none') return [];
  if (!presetsFor(input.runtimeId).includes(input.choice)) return ['preset_not_for_runtime'];
  if (!transportOk) return ['insecure_transport'];
  const issues: ProviderIssue[] = [];
  if (!input.baseUrl.trim()) issues.push('base_url_required');
  else if (!validateBaseUrl(input.baseUrl).ok) issues.push('base_url_invalid');
  const modelIssue = validateCodexModel(input.model);
  if (modelIssue) issues.push(modelIssue);
  const key = validateApiKey(input.apiKey);
  if (key === 'empty') issues.push('api_key_required');
  else if (key === 'invalid') issues.push('api_key_invalid');
  else if (key === 'too_long') issues.push('api_key_too_long');
  return issues;
}

export function providerIssueI18nKey(issue: ProviderIssue): string {
  return `provider.err.${issue}`;
}

export function presetLabelKey(choice: ProviderChoice): string {
  return choice === 'custom-openai-compat' ? 'provider.preset.custom' : `provider.preset.${choice}`;
}

export function providerCreateError(input: ProviderCheckInput): string | null {
  const issues = providerLocalIssues(input);
  return issues.length ? PROVIDER_ISSUE_ZH[issues[0]] : null;
}

export type CodexSubmitGate =
  | { action: 'omit' }
  | { action: 'block'; issue: ProviderIssue };

/**
 * 没选供应商 → omit,创建请求保持原样。
 * 选了供应商 → block。这一版没有密钥库,不能把 node_spec 发出去(那会丢掉密钥)。
 */
export function codexSubmitGate(input: ProviderCheckInput, serverUrl?: string): CodexSubmitGate {
  if (input.choice === 'none') return { action: 'omit' };
  const transportOk = serverUrl === undefined || hubTransportAllowsSecrets(serverUrl);
  const local = providerLocalIssues(input, transportOk);
  if (local.length) return { action: 'block', issue: local[0] };
  return { action: 'block', issue: 'hub_not_ready' };
}

export function buildNodeSpecProvider(input: ProviderCheckInput): NodeSpecProvider | null {
  if (input.choice === 'none') return null;
  const error = providerCreateError(input);
  if (error) throw new Error(error);
  const base = validateBaseUrl(input.baseUrl);
  if (!base.ok) throw new Error(PROVIDER_ISSUE_ZH.base_url_invalid);
  const provider: NodeSpecProvider = { preset: input.choice, base_url: base.url, model: input.model.trim() };
  const ref = input.secretRef?.trim();
  if (ref) provider.secret_ref = ref;
  return provider;
}

/** 不选 provider 时返回原对象。本版向导不调用它来发请求。 */
export function withProviderField<T extends object>(spec: T, provider: NodeSpecProvider | null): T {
  if (!provider) return spec;
  return { ...spec, provider };
}

export function providerStateSnapshot(form: ProviderFormValue): {
  choice: ProviderChoice;
  baseUrl: string;
  model: string;
  secretRef: string | null;
  apiKeyEntered: boolean;
} {
  return {
    choice: form.choice,
    baseUrl: form.baseUrl,
    model: form.model,
    secretRef: form.secretRef,
    apiKeyEntered: form.apiKey.length > 0,
  };
}

export function providerSummary(form: ProviderFormValue): {
  preset: ProviderChoice;
  baseUrl: string;
  model: string;
  credential: 'none' | 'entered';
} {
  if (form.choice === 'none') return { preset: 'none', baseUrl: '', model: '', credential: 'none' };
  return {
    preset: form.choice,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    credential: form.apiKey ? 'entered' : 'none',
  };
}

export function scrubSecret(text: string, secret: string): string {
  if (!secret || !text.includes(secret)) return text;
  return text.split(secret).join('[redacted]');
}

const PROVIDER_FLAG_FIELDS = ['provider', 'preset', 'base_url', 'secret_ref'];

function mentionsProviderField(field: string | null | undefined, why: string): boolean {
  if (field && PROVIDER_FLAG_FIELDS.includes(field)) return true;
  return PROVIDER_FLAG_FIELDS.some(name => new RegExp(`(?:flag_key_unknown|unknown[_ -]?field)[: ]+${name}\\b`, 'i').test(why));
}

/** 旧 Hub 拒绝 provider 字段时的人话。调用方不得去掉 provider 再重试。 */
export function describeProviderCreateError(e: { error?: string | null; field?: string | null }): string | null {
  const why = (e.error ?? '').trim();
  if (!why && !e.field) return null;
  if ((why === 'flag_key_unknown' || why === 'unknown_field' || why === 'unknown-field') && mentionsProviderField(e.field, why)) {
    return PROVIDER_ISSUE_ZH.unsupported_hub;
  }
  if (mentionsProviderField(e.field, why) && /flag_key_unknown|unknown[_ -]?field/i.test(why)) {
    return PROVIDER_ISSUE_ZH.unsupported_hub;
  }
  if (why === 'insecure_transport' || /\binsecure_transport\b/.test(why)) return PROVIDER_ISSUE_ZH.insecure_transport;
  if (why === 'provider_invalid' || /\bprovider_invalid\b/.test(why)) return PROVIDER_ISSUE_ZH.base_url_invalid;
  if (why === 'secret_not_in_vault' || /\bsecret_not_in_vault\b/.test(why)) {
    return '密钥库里没有这个名字。不会改用空密钥创建。';
  }
  if (why === 'insufficient_role_for_provider' || /\binsufficient_role_for_provider\b/.test(why)) {
    return '当前账号不能写入供应商密钥（需要 owner 或 admin）。';
  }
  return null;
}

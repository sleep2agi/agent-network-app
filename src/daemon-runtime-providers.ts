// #906 —— daemon 范围的供应商 / 模型展示。纯函数,不 import react-native。
//
// 只读 Hub / daemon **已经带上**的两处:
//   ① host-supervisor 的 `runtime_readiness[runtime]` 里多出来的
//      providers / model_providers / models(旧形状没有这些键 ⇒ 没上报)
//   ② `list_providers`(挂在 daemon 上,或工具返回体)里**标了 runtime** 的行
// 没标 runtime 的网络级供应商不算「这台机器、这个 runtime 可用」。
// 两处都没有这一格 ⇒ 调用方显示升级,不许用本地预设假装 daemon 报过。
//
// 密钥:只抄白名单字段。api_key / secret / token / secret_key_ref 不进结果。
// base_url 带用户名或密码的整段丢掉。看起来像密钥的模型 id 丢掉。

import { isCodexRuntime } from './provider-create-options';

const SECRET_PREFIX = /^(sk-|sk-ant-|sk-proj-|ghp_|gho_|github_pat_|xox[baprs]-|AKIA|AIza|ya29\.|glpat-)/i;
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_RUNTIMES = 32;
const MAX_PROVIDERS = 32;
const MAX_MODELS = 64;

export interface PublicProvider {
  id: string;
  baseUrl: string | null;
  models: string[];
}

export interface TaggedProvider {
  runtimeIds: string[];
  id: string;
  baseUrl: string | null;
  models: string[];
}

export interface DaemonProviderSource {
  runtime_readiness?: unknown;
  list_providers?: unknown;
}

type Tone = 'codex' | 'opencode' | 'generic';

export type DaemonProviderDisplay =
  | { kind: 'upgrade'; tone: Tone }
  | { kind: 'read-error'; tone: Tone }
  | { kind: 'empty'; tone: Tone }
  | { kind: 'unlisted'; tone: Tone }
  | { kind: 'codex'; providers: PublicProvider[] }
  | { kind: 'opencode'; models: string[] }
  | { kind: 'listed'; providers: PublicProvider[] };

interface RuntimeBucket {
  reported: boolean;
  providers: PublicProvider[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_PREFIX.test(value);
}

function safeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!TOKEN.test(s) || looksLikeSecret(s)) return null;
  return s;
}

function publicBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > 300 || looksLikeSecret(s)) return null;
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.toString();
}

function isOpenCodeModel(model: string): boolean {
  const parts = model.split('/');
  if (parts.length !== 2) return false;
  return safeToken(parts[0]) === parts[0] && safeToken(parts[1]) === parts[1];
}

function modelToken(value: unknown): string | null {
  if (typeof value === 'string') {
    const s = value.trim();
    if (isOpenCodeModel(s)) return s;
    return safeToken(s);
  }
  if (!isRecord(value)) return null;
  const raw = value.model_name ?? value.model ?? value.id ?? value.name;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (isOpenCodeModel(s)) return s;
  return safeToken(s);
}

function collectModels(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out: string[] = [];
  for (const item of raw) {
    const model = modelToken(item);
    if (model && !out.includes(model) && out.length < MAX_MODELS) out.push(model);
  }
  return out;
}

function isPlainModel(model: string): boolean {
  return !model.includes('/') && model.length <= 100;
}

function providerId(row: Record<string, unknown>): string {
  for (const key of ['id', 'preset', 'name', 'provider_id', 'vendor'] as const) {
    const id = safeToken(row[key]);
    if (id) return id;
  }
  return '';
}

function fromProviderRecord(row: unknown): PublicProvider | null {
  if (!isRecord(row)) return null;
  const models = collectModels(row.models ?? row.model);
  const id = providerId(row);
  const baseUrl = publicBaseUrl(row.base_url ?? row.baseURL);
  if (!id && models.length === 0 && !baseUrl) return null;
  return { id, baseUrl, models };
}

function fromProviderField(value: unknown): PublicProvider[] {
  if (Array.isArray(value)) {
    const out: PublicProvider[] = [];
    for (const item of value) {
      const provider = fromProviderRecord(item);
      if (provider && out.length < MAX_PROVIDERS) out.push(provider);
    }
    return out;
  }
  if (!isRecord(value)) return [];
  const out: PublicProvider[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (out.length >= MAX_PROVIDERS) break;
    const id = safeToken(key);
    if (!isRecord(item)) {
      const models = collectModels(item);
      if (id && models.length) out.push({ id, baseUrl: null, models });
      continue;
    }
    const provider = fromProviderRecord(item);
    if (!provider) continue;
    out.push({ ...provider, id: id || provider.id });
  }
  return out;
}

function entryReported(entry: Record<string, unknown>): boolean {
  if (Array.isArray(entry.providers) || isRecord(entry.providers)) return true;
  if (Array.isArray(entry.available_providers) || isRecord(entry.available_providers)) return true;
  if (Array.isArray(entry.model_providers) || isRecord(entry.model_providers)) return true;
  if (Array.isArray(entry.models) || Array.isArray(entry.available_models)) return true;
  return false;
}

function entryProviders(entry: Record<string, unknown>): PublicProvider[] {
  const gathered: PublicProvider[] = [];
  gathered.push(...fromProviderField(entry.model_providers));
  gathered.push(...fromProviderField(entry.providers));
  gathered.push(...fromProviderField(entry.available_providers));
  const bare = [...collectModels(entry.models), ...collectModels(entry.available_models)];
  if (bare.length) gathered.push({ id: '', baseUrl: null, models: bare });
  return unionProviders(gathered).slice(0, MAX_PROVIDERS);
}

export function unionProviders(list: PublicProvider[]): PublicProvider[] {
  const by = new Map<string, PublicProvider>();
  for (const provider of list) {
    const key = `${provider.id}\0${provider.baseUrl ?? ''}`;
    const prev = by.get(key);
    if (!prev) {
      by.set(key, { id: provider.id, baseUrl: provider.baseUrl, models: [...provider.models] });
      continue;
    }
    for (const model of provider.models) {
      if (!prev.models.includes(model) && prev.models.length < MAX_MODELS) prev.models.push(model);
    }
  }
  return [...by.values()];
}

function providerArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  if (payload.ok === false) return null;
  if (Array.isArray(payload.providers)) return payload.providers;
  if (Array.isArray(payload.list_providers)) return payload.list_providers;
  return null;
}

function runtimeIdsOf(row: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const one = safeToken(row.runtime ?? row.runtime_id);
  if (one) ids.push(one);
  if (Array.isArray(row.runtimes)) {
    for (const item of row.runtimes) {
      const id = safeToken(item);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** list_providers 里标了 runtime 的行。没标的丢掉,密钥字段不抄。 */
export function taggedFromPayload(payload: unknown): TaggedProvider[] {
  const rows = providerArray(payload);
  if (!rows) return [];
  const out: TaggedProvider[] = [];
  for (const row of rows) {
    if (out.length >= MAX_PROVIDERS) break;
    if (!isRecord(row)) continue;
    const runtimeIds = runtimeIdsOf(row);
    if (runtimeIds.length === 0) continue;
    const provider = fromProviderRecord(row);
    if (!provider) continue;
    out.push({ runtimeIds, id: provider.id, baseUrl: provider.baseUrl, models: provider.models });
  }
  return out;
}

function bucketsFrom(daemon: DaemonProviderSource | null | undefined, rows: readonly TaggedProvider[]): Map<string, RuntimeBucket> {
  const buckets = new Map<string, RuntimeBucket>();
  const readiness = daemon?.runtime_readiness;
  if (isRecord(readiness)) {
    for (const [runtimeId, entry] of Object.entries(readiness)) {
      if (buckets.size >= MAX_RUNTIMES) break;
      const id = safeToken(runtimeId);
      if (!id || !isRecord(entry) || !entryReported(entry)) continue;
      buckets.set(id, { reported: true, providers: entryProviders(entry) });
    }
  }
  const tagged = [...taggedFromPayload(daemon?.list_providers), ...rows];
  for (const row of tagged) {
    for (const runtimeId of row.runtimeIds) {
      if (!buckets.has(runtimeId) && buckets.size >= MAX_RUNTIMES) continue;
      const prev = buckets.get(runtimeId) ?? { reported: true, providers: [] };
      prev.reported = true;
      prev.providers = unionProviders([...prev.providers, { id: row.id, baseUrl: row.baseUrl, models: row.models }]);
      buckets.set(runtimeId, prev);
    }
  }
  return buckets;
}

function toneFor(runtimeId: string, generation?: 'v1' | 'v2'): Tone {
  if (isCodexRuntime(runtimeId)) return 'codex';
  if (runtimeId === 'opencode-cli' && generation === 'v2') return 'opencode';
  return 'generic';
}

function codexProviders(providers: PublicProvider[]): PublicProvider[] {
  const out: PublicProvider[] = [];
  for (const provider of providers) {
    const models = provider.models.filter(isPlainModel);
    if (models.length === 0) continue;
    out.push({ id: provider.id, baseUrl: provider.baseUrl, models });
  }
  return out;
}

function opencodeModels(providers: PublicProvider[]): string[] {
  const out: string[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      const pair = model.includes('/')
        ? (isOpenCodeModel(model) ? model : null)
        : (provider.id && isPlainModel(model) ? `${provider.id}/${model}` : null);
      if (pair && isOpenCodeModel(pair) && !out.includes(pair) && out.length < MAX_MODELS) out.push(pair);
    }
  }
  return out;
}

/** Codex 与 OpenCode V2 始终给出升级/空列表。其它 runtime 只在真有上报时出现。 */
export function catalogIsVisible(
  display: DaemonProviderDisplay | { kind: 'pending' },
  runtimeId: string,
  generation?: 'v1' | 'v2',
): boolean {
  if (display.kind === 'codex' || display.kind === 'opencode' || display.kind === 'listed') return true;
  return isCodexRuntime(runtimeId) || (runtimeId === 'opencode-cli' && generation === 'v2');
}

export function displayDaemonProviders(args: {
  daemon: DaemonProviderSource | null | undefined;
  rows?: readonly TaggedProvider[];
  read: 'pending' | 'ok' | 'unsupported' | 'error';
  runtimeId: string;
  opencodeGeneration?: 'v1' | 'v2';
}): DaemonProviderDisplay | { kind: 'pending' } {
  const rows = args.rows ?? [];
  const tone = toneFor(args.runtimeId, args.opencodeGeneration);
  const daemonOnly = bucketsFrom(args.daemon, []);
  const merged = bucketsFrom(args.daemon, rows);
  const exposed = merged.size > 0;
  if (!exposed && args.read === 'pending' && daemonOnly.size === 0) return { kind: 'pending' };
  if (!exposed && args.read === 'error') return { kind: 'read-error', tone };
  if (!exposed) return { kind: 'upgrade', tone };
  const bucket = merged.get(args.runtimeId);
  if (!bucket?.reported) return { kind: 'unlisted', tone };
  if (tone === 'codex') {
    const providers = codexProviders(bucket.providers);
    return providers.length ? { kind: 'codex', providers } : { kind: 'empty', tone };
  }
  if (args.runtimeId === 'opencode-cli') {
    const models = opencodeModels(bucket.providers);
    return models.length ? { kind: 'opencode', models } : { kind: 'empty', tone };
  }
  const providers = bucket.providers.filter(provider => provider.models.length > 0 || provider.id);
  return providers.length ? { kind: 'listed', providers } : { kind: 'empty', tone };
}

type ToolParse =
  | { kind: 'payload'; payload: unknown }
  | { kind: 'rpc'; message: string }
  | { kind: 'malformed' };

function parseToolBody(raw: string): ToolParse {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    const last = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean).pop();
    if (!last) return { kind: 'malformed' };
    try { envelope = JSON.parse(last); } catch { return { kind: 'malformed' }; }
  }
  if (!isRecord(envelope)) return { kind: 'malformed' };
  const error = envelope.error;
  if (isRecord(error)) return { kind: 'rpc', message: typeof error.message === 'string' ? error.message : '' };
  const result = isRecord(envelope.result) ? envelope.result : null;
  const content = result && Array.isArray(result.content) ? result.content : [];
  const first = content[0];
  const text = isRecord(first) && typeof first.text === 'string' ? first.text : null;
  if (text === null) return { kind: 'malformed' };
  if (result?.isError === true) return { kind: 'rpc', message: text };
  try { return { kind: 'payload', payload: JSON.parse(text) }; } catch { return { kind: 'malformed' }; }
}

/** HTTP 状态 + 响应体 → 可展示的行。结果里不带回响应原文。 */
export function interpretListProvidersHttp(status: number, body: string):
  | { kind: 'ok'; rows: TaggedProvider[] }
  | { kind: 'unsupported' }
  | { kind: 'error' } {
  if (status === 404 || status === 501) return { kind: 'unsupported' };
  if (status < 200 || status >= 300) return { kind: 'error' };
  const parsed = parseToolBody(body);
  if (parsed.kind === 'malformed') return { kind: 'unsupported' };
  if (parsed.kind === 'rpc') return /not found|unknown tool/i.test(parsed.message) ? { kind: 'unsupported' } : { kind: 'error' };
  if (isRecord(parsed.payload) && parsed.payload.ok === false) return { kind: 'error' };
  return { kind: 'ok', rows: taggedFromPayload(parsed.payload) };
}

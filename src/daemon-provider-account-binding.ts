import type { ProviderSnapshot } from './daemon-provider-management';
/** Reference a daemon-owned saved account, never an auth file or token. The
 * daemon revalidates ownership/presence when the optimistic revision is written. */
export function providerAccountWrite(snapshot: ProviderSnapshot, accountId: string, modelText: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(accountId)) return null;
  const models = [...new Set(modelText.split(/[,，\n]/).map(m => m.trim()).filter(Boolean))];
  if (!models.length || models.length > 200 || models.some(m => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(m))) return null;
  const old = snapshot.providers.find(p => p.id === 'openai');
  const auth = old?.runtimes.find(r => r.runtime === 'codex-tui')?.auth ?? [];
  if (auth.some(a => a.id === accountId && a.kind !== 'chatgpt')) return null;
  const retained = auth.filter(a => a.id !== accountId).map(a => ({ id: a.id, kind: a.kind, models: [...a.models],
    ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}), ...(a.account_id ? { account_id: a.account_id } : {}) }));
  if (retained.length >= 32) return null;
  return { revision: snapshot.revision, provider: { id: 'openai', label: old?.label ?? 'OpenAI', enabled: old?.enabled ?? true,
    runtimes: [{ runtime: 'codex-tui', auth: [...retained, { id: accountId, kind: 'chatgpt', account_id: accountId, models }] }] } };
}

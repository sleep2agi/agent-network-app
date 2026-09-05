import { strict as assert } from 'node:assert';

const { activateHubProfile, LOCAL_HUB_PROFILE_ID } = await import('./local-hub');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// 桌面端切到 Local workspace:先 start_local_hub,再 switch(顺序是判据 —— 反过来 switch 会先在钥匙串上失败)
{
  const calls: string[] = [];
  const cfg = await activateHubProfile(LOCAL_HUB_PROFILE_ID, {
    isDesktop: () => true,
    startLocalHub: async () => { calls.push('start'); return { state: 'running', session: { token: 't' } as any, error: null }; },
    switchHubProfile: async (id) => { calls.push(`switch:${id}`); return { profileId: id }; },
  });
  check(calls.join(',') === `start,switch:${LOCAL_HUB_PROFILE_ID}`, 'local on desktop: start_local_hub runs before switch');
  check(cfg.profileId === LOCAL_HUB_PROFILE_ID, 'returns the switched config');
}

// 本地 Hub 起来了但没有会话 → 抛它自己的错误(不去 switch,免得把一个没凭据的 profile 设成当前)
{
  const calls: string[] = [];
  let thrown = '';
  try {
    await activateHubProfile(LOCAL_HUB_PROFILE_ID, {
      isDesktop: () => true,
      startLocalHub: async () => { calls.push('start'); return { state: 'error', session: null, error: 'local Hub bootstrap failed: x' }; },
      switchHubProfile: async (id) => { calls.push(`switch:${id}`); return { profileId: id }; },
    });
  } catch (error) { thrown = (error as Error).message; }
  check(thrown === 'local Hub bootstrap failed: x', 'surfaces the local Hub error verbatim');
  check(calls.join(',') === 'start', 'does not switch when the local Hub has no session');
}

// 没有 error 字段时给一个带状态的中文说明
{
  let thrown = '';
  try {
    await activateHubProfile(LOCAL_HUB_PROFILE_ID, {
      isDesktop: () => true,
      startLocalHub: async () => ({ state: 'stopped', session: null, error: null }),
      switchHubProfile: async (id) => ({ profileId: id }),
    });
  } catch (error) { thrown = (error as Error).message; }
  check(thrown.includes('stopped') && thrown.includes('本地工作区'), 'fallback message names the state');
}

// 远程 profile / 非桌面:不碰本地 Hub
for (const [id, desktop] of [['remote-1', true], [LOCAL_HUB_PROFILE_ID, false]] as const) {
  const calls: string[] = [];
  await activateHubProfile(id, {
    isDesktop: () => desktop,
    startLocalHub: async () => { calls.push('start'); return { state: 'running', session: { token: 't' } as any, error: null }; },
    switchHubProfile: async (target) => { calls.push(`switch:${target}`); return { profileId: target }; },
  });
  check(calls.join(',') === `switch:${id}`, `${id} desktop=${desktop}: switch only`);
}

// App.tsx 接线契约:activateProfile 走 activateHubProfile,而不是裸 switchHubProfile
{
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = app.slice(app.indexOf('const activateProfile = async'), app.indexOf('const requestProfileReauth'));
  check(body.includes('activateHubProfile(profileId, { isDesktop: () => tauriDesktop, startLocalHub, switchHubProfile })'), 'App.activateProfile delegates to activateHubProfile with the real start/switch');
  check(!/\bawait switchHubProfile\(profileId\)/.test(body), 'App.activateProfile no longer calls switchHubProfile directly');
}

console.log(`local hub activate: ${ck} checks passed`);

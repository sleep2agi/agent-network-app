import { checkDesktopUpdate, desktopUpdateSnapshot, installDesktopUpdate } from './desktop-updater';

const ck = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
};

(globalThis as any).__TAURI_INTERNALS__ = {};

const available = await checkDesktopUpdate(async () => ({
  version: '99.0.0',
  body: 'offline fixture',
  downloadAndInstall: async () => undefined,
}));
ck('online fixture can stage an update', available.kind === 'available');

const offline = await checkDesktopUpdate(async () => {
  throw new Error('network unreachable');
});
ck(
  'offline update check becomes a retryable error instead of rejecting startup',
  offline.kind === 'error' && offline.message === 'network unreachable',
);
ck('offline state is published to settings and prompt subscribers', desktopUpdateSnapshot().kind === 'error');

let staleInstallRejected = false;
try {
  await installDesktopUpdate();
} catch (error: any) {
  staleInstallRejected = error?.message === '没有待安装的更新';
}
ck('offline failure clears any previously staged update', staleInstallRejected);

const recovered = await checkDesktopUpdate(async () => null);
ck('manual retry recovers after connectivity returns', recovered.kind === 'up-to-date');

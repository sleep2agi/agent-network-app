// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
import { readFileSync } from 'node:fs';
import { appFetch } from './app-fetch';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('./app-fetch.ts', import.meta.url), 'utf8');
const capabilities = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
const httpPermission = capabilities.permissions.find((permission: unknown) =>
  typeof permission === 'object' && permission !== null && permission.identifier === 'http:default'
);
const allowedHubUrls = new Set(httpPermission?.allow?.map(({ url }: { url: string }) => url));

ck('App never replaces the global fetch used by Tauri IPC', !/globalThis[^\n]*\.fetch\s*=/.test(appSource));
ck('Tauri transport calls the plugin explicitly', /tauriFetch\(input, init\)/.test(transportSource));
ck('web transport delegates to the current global fetch', /globalThis\.fetch\(input, init\)/.test(transportSource));
ck('Tauri transport permits HTTP hubs on explicit ports', allowedHubUrls.has('http://*:*/*'));
ck('Tauri transport permits HTTPS hubs on explicit ports', allowedHubUrls.has('https://*:*/*'));

const originalFetch = globalThis.fetch;
try {
  let seen = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen = String(input);
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  const response = await appFetch('http://127.0.0.1/test');
  ck('non-Tauri runtime uses the browser/RN transport', seen === 'http://127.0.0.1/test' && response.ok);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);

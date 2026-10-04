// 10-04 fiona(两个网络的成员)在 agent 会话里发图全部 400 network_id_required:上传从不带 network_id。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { resolveUploadNetworkId, uploadUrlFor } from './upload-url';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

(async () => {
  let calls = 0;
  const lookup = async () => { calls++; return 'net_granted'; };
  ck('explicit opts.networkId wins, no lookup', (await resolveUploadNetworkId({ networkId: 'net_dm' }, 'net_cfg', lookup)) === 'net_dm' && calls === 0);
  ck('falls back to the app network (cfg.networkId), no lookup', (await resolveUploadNetworkId({}, 'net_cfg', lookup)) === 'net_cfg' && calls === 0);
  ck('no cfg network → looks it up (multi-network account)', (await resolveUploadNetworkId({}, undefined, lookup)) === 'net_granted' && calls === 1);
  ck('lookup failure → undefined (upload as before, no throw)', (await resolveUploadNetworkId({}, undefined, async () => { throw new Error('offline'); })) === undefined);
  ck('resolved id lands on the upload URL', uploadUrlFor('https://h', { networkId: 'net_granted' }) === 'https://h/api/upload?network_id=net_granted');
  // 接线:uploadImage 必须用解析结果拼地址,不能再直接用 opts(那就是 fiona 的 bug)
  const attach = readFileSync(new URL('./attach.ts', import.meta.url), 'utf8');
  ck('uploadImage resolves the network before building the URL', /resolveUploadNetworkId\(opts, cfg\.networkId/.test(attach) && /uploadUrlFor\(cfg\.serverUrl, \{ \.\.\.opts, \.\.\.\(networkId/.test(attach));
  ck('uploadImage no longer builds the URL from bare opts', !/uploadUrlFor\(cfg\.serverUrl, opts\)/.test(attach));
  console.log(`upload-network: ${p}/${n}`);
  if (p !== n) process.exit(1);
})();

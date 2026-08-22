import fs from 'node:fs';
import path from 'node:path';
import { profileIdFor } from './profile-model';

let passed = 0; let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (!ok) throw new Error(`FAIL: ${name}`); passed++; console.log(`✅ ${name}`); };

ck('same hub/account/network has stable id', profileIdFor('https://hub.test/', 'Admin', 'net_1') === profileIdFor('https://HUB.test', 'admin', 'net_1'));
ck('different username is a different profile', profileIdFor('https://hub.test', 'admin', 'net_1') !== profileIdFor('https://hub.test', 'alice', 'net_1'));
ck('different hub is a different profile', profileIdFor('https://hub-a.test', 'admin', 'net_1') !== profileIdFor('https://hub-b.test', 'admin', 'net_1'));
ck('different network is a different profile', profileIdFor('https://hub.test', 'admin', 'net_1') !== profileIdFor('https://hub.test', 'admin', 'net_2'));
const source = fs.readFileSync(path.join(process.cwd(), 'src/profile-storage.ts'), 'utf8');
ck('registry never serializes cfg token', !source.includes('token: cfg.token'));
ck('legacy single-account key has migration path', source.includes("LEGACY_KEY = 'hub_config_v1'") && source.includes('deleteItemAsync(LEGACY_KEY)'));

console.log(`\n${passed}/${total} passed`); process.exit(passed === total ? 0 : 1);

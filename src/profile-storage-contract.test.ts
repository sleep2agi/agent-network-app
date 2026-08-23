import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const rust = fs.readFileSync(path.join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8');
const storage = fs.readFileSync(path.join(process.cwd(), 'src/storage.ts'), 'utf8');
const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

assert.ok(rust.includes('join(".anet").join("app")'), 'canonical ~/.anet/app root');
assert.ok(!rust.includes('.anet_app'), 'never creates ~/.anet_app');
assert.ok(rust.includes('fs::rename(&tmp, path)') && rust.includes('AtomicFile::new(path, AllowOverwrite)'), 'metadata writes atomically on Mac and Windows');
assert.ok(rust.includes('hub-profile-{profile_id}'), 'tokens are keyed by immutable profile id');
assert.ok(rust.includes('profile_registry_metadata_never_serializes_secrets'), 'registry has a no-secret assertion');
assert.ok(rust.includes('active-hub-session') && rust.includes('One-time migration'), 'legacy credential is migrated');
assert.ok(storage.includes("'cache/sessions.json'") && storage.includes("'outbox.json'"), 'cache and outbox are profile scoped');
assert.ok(storage.includes("'preferences/avatars.json'"), 'avatar overrides are profile scoped');
assert.ok(app.includes("workspaceKey = `${theme}:${cfg?.profileId"), 'workspace remounts on profile switch');
assert.ok(app.includes('switchHubProfile(initialChatProfile)'), 'detached windows restore their pinned profile');

console.log('profile storage contract: 10 checks passed');

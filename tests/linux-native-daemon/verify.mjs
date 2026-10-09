import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.ANET_PACKAGED_SMOKE_ROOT;
assert.equal(root, '/home/smoke/native-daemon-test');
const prefix = join(root, 'local-daemon/anet');
const policy = readFileSync('/fixture/daemon-policy.rs', 'utf8');
const expected = name => {
  const match = policy.match(new RegExp(`pub const ${name}: &str = "([^"]+)";`));
  assert.ok(match, `missing product constant ${name}`);
  return match[1];
};
for (const [name, constant] of [['agent-network', 'ANET_VERSION'], ['agent-node', 'AGENT_NODE_VERSION']]) {
  const pkg = JSON.parse(readFileSync(join(prefix, 'lib/node_modules/@sleep2agi', name, 'package.json'), 'utf8'));
  assert.equal(pkg.name, `@sleep2agi/${name}`);
  assert.equal(pkg.version, expected(constant));
}
const fingerprint = () => {
  const hash = createHash('sha256');
  const entries = {};
  const walk = relative => {
    const path = join(prefix, relative);
    const stat = lstatSync(path);
    hash.update(`${relative}\0${stat.mode}\0`);
    if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(path)}\0`);
    else if (stat.isDirectory()) for (const entry of readdirSync(path).sort()) walk(join(relative, entry));
    else if (stat.isFile()) hash.update(readFileSync(path));
    else assert.fail(`unexpected special file: ${relative}`);
    entries[relative] = { mode: stat.mode, content: stat.isSymbolicLink() ? readlinkSync(path) : stat.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'directory' };
  };
  walk('');
  return { hash: hash.digest('hex'), entries };
};
const phase = process.argv[2];
const agentEntry = join(prefix, 'lib/node_modules/@sleep2agi/agent-node/dist/cli.js');
if (phase === 'before-partial') {
  // Deliberate corruption only inside this fresh disposable test container.
  unlinkSync(agentEntry);
}
if (phase === 'before' || phase === 'before-partial') {
  writeFileSync('/evidence/private-prefix-before.json', JSON.stringify(fingerprint()));
} else {
  assert.ok(['empty', 'exact', 'partial'].includes(phase));
  assert.ok(existsSync(join(root, 'local-hub/data/commhub.db')), 'real bundled Hub database');
  // Native smoke itself asserts successful Hub supervisor registration and
  // matching node_id/profile on rescan. Do not dump test auth configuration.
  if (phase === 'exact' || phase === 'partial') {
    const before = JSON.parse(readFileSync('/evidence/private-prefix-before.json', 'utf8'));
    const after = fingerprint();
    const changed = [...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])].filter(path => JSON.stringify(before.entries[path]) !== JSON.stringify(after.entries[path]));
    if (changed.length) console.error('Changed prefix entries (hashes/modes only):', changed.slice(0, 20).map(path => ({ path, before: before.entries[path], after: after.entries[path] })));
    assert.equal(after.hash, before.hash, 'existing exact package contents/modes/links unchanged');
  }
  if (phase === 'partial') {
    assert.ok(!existsSync(agentEntry), 'broken entry was not silently reinstalled');
    assert.ok(!existsSync(join(root, 'local-daemon/home/.anet/config.json')), 'no private Hub credentials written');
    assert.ok(!existsSync(join(root, 'local-daemon/.anet/nodes/local-daemon/config.json')), 'no daemon profile registered');
    assert.ok(!existsSync(join(root, 'local-daemon/start.log')), 'daemon launch not reached');
  }
  console.log(`PASS: ${process.argv[2]} exact package versions; existing-prefix integrity when applicable`);
}

"""Only seed the isolated model provider; node identity must be created by UI."""
import json
import os
from pathlib import Path

assert os.getuid() == 10001
root = Path('/home/smoke/v2-native/.anet/nodes/v2-native')
assert not (root / 'config.json').exists(), 'node must not already exist'
config_dir = root / '.config/opencode'
config_dir.mkdir(parents=True, mode=0o700)
for directory in [root, root / '.config', config_dir]:
    directory.chmod(0o700)
provider = {'model': 'stub/stub-model', 'provider': {'stub': {
    'npm': '@ai-sdk/openai-compatible', 'name': 'Fixture',
    'options': {'baseURL': 'http://127.0.0.1:18827/v1', 'apiKey': 'test-only'},
    'models': {'stub-model': {'name': 'Fixture'}, 'stub-model-next': {'name': 'Next fixture'}}}}}
path = config_dir / 'opencode.json'
path.write_text(json.dumps(provider))
path.chmod(0o600)
print('PASS: isolated provider seeded; no node identity/config created')

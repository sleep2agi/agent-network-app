"""Bind the dependency probe to the product's Linux backend selection."""
import tomllib
from pathlib import Path

app = tomllib.loads(Path('/app/Cargo.toml').read_text())
probe = tomllib.loads(Path('/probe/Cargo.toml').read_text())
native = app['target']['cfg(target_os = "linux")']['dependencies']['keyring']
assert set(native['features']) == set(probe['dependencies']['keyring']['features'])
assert app['dependencies']['keyring'] == '3'
locks = {}
for root in ('/app', '/probe'):
    lock = tomllib.loads(Path(root, 'Cargo.lock').read_text())
    locks[root] = {(p['name'], p['version']): p for p in lock['package']}
    versions = [p['version'] for p in lock['package'] if p['name'] == 'keyring']
    assert versions == ['3.6.3'], (root, versions)
for identity, package in locks['/probe'].items():
    if package.get('source', '').startswith('registry+'):
        assert identity in locks['/app'], ('probe dependency drift', identity)
        assert package['checksum'] == locks['/app'][identity]['checksum'], identity
print('product/probe keyring version and Linux backend features agree')

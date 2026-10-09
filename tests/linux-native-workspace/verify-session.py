"""TEST ONLY: read isolated native credential in memory; never output secrets."""
import json
import os
import pathlib
import subprocess
import urllib.error
import urllib.request

root = pathlib.Path(os.environ['ANET_PACKAGED_SMOKE_ROOT'])
index = json.loads((root / 'profiles/index.json').read_text())
assert index['active_profile_id'] == 'local-workspace', 'wrong active profile'
profile = next(p for p in index['profiles'] if p['profileId'] == 'local-workspace')
assert profile['username'] == 'local-admin', 'wrong local identity'
endpoint = profile['serverUrl']
assert endpoint.startswith('http://127.0.0.1:'), 'not loopback'
secret = subprocess.run(['secret-tool', 'lookup', 'service',
    'top.vansin.agentnetwork.desktop', 'username', 'hub-profile-local-workspace'],
    capture_output=True, check=True, timeout=10).stdout.decode().strip()
assert secret, 'native credential missing'
for route in ['/api/auth/me', '/api/status']:
    request = urllib.request.Request(endpoint + route, headers={'Authorization': 'Bearer ' + secret})
    with urllib.request.urlopen(request, timeout=10) as response:
        assert response.status == 200, 'authenticated API failed'
        payload = json.load(response)
        assert payload.get('ok') is True, 'API rejected native session'
try:
    urllib.request.urlopen(urllib.request.Request(endpoint + '/api/auth/me',
        headers={'Authorization': 'Bearer deliberately-invalid-test-token'}), timeout=10)
except urllib.error.HTTPError as error:
    assert error.code == 401, 'invalid credential was not rejected with 401'
else:
    raise AssertionError('invalid credential accepted')
print('PASS: local profile/native Secret Service credential/API auth; wrong token rejected 401')

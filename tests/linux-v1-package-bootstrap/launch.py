"""Actual CLI pre-Hub launch only. The rejecting HTTP fixture is NOT CommHub."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

assert os.getuid() == 10001
assert re.fullmatch('[a-f0-9]{40}', os.environ['APP_SOURCE_COMMIT'])
node_home = Path.home() / 'v1-native'
node_dir = node_home / '.anet/nodes/v1-native'
node_dir.mkdir(parents=True, mode=0o700)
auth_dir = node_dir / '.local/share/opencode'
auth_dir.mkdir(parents=True, mode=0o700)
for parent in [node_dir, node_dir / '.local', node_dir / '.local/share', auth_dir]:
    parent.chmod(0o700)
(auth_dir / 'auth.json').write_text(json.dumps({'openai': {'type': 'api', 'key': 'test-only-v1-acp'}}))
(auth_dir / 'auth.json').chmod(0o600)
config = node_dir / 'config.json'
config.write_text(json.dumps({
    'node_id': 'node_test894_bootstrap', 'node_name': 'v1-native', 'alias': 'v1-native',
    'runtime': 'opencode-cli', 'model': 'opencode/mimo-v2.6-flash-free',
    'hub': 'http://127.0.0.1:18883', 'token': 'ntok_test_only_bootstrap',
    'opencodeGeneration': 'v1', 'opencodeMode': 'headless',
    'flags': {'opencodeUnsafeTools': False},
}))
config.chmod(0o600)
requests = []


class RejectHub(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reject(self):
        # Count only a method, never bodies, headers, credentials or query args.
        requests.append(self.command)
        body = b'{"ok":false,"error":"test_only_rejecting_hub"}'
        self.send_response(401)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = reject
    do_POST = reject


server = ThreadingHTTPServer(('127.0.0.1', 18883), RejectHub)
threading.Thread(target=server.serve_forever, daemon=True).start()
prefix = Path(os.environ['ANET_PACKAGED_SMOKE_ROOT']) / 'local-daemon/anet'
# Same fixed Linux minimalEnv keys plus explicit private bin directory; no
# proxy/CA/ambient identity changes. Provider/model execution is never requested.
env = {'HOME': str(Path.home()), 'LANG': 'C.UTF-8',
       'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:' + str(prefix / 'bin')}
child = None
try:
    child = subprocess.Popen([str(prefix / 'bin/anet'), 'node', 'start', 'v1-native'],
        cwd=node_home, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    timed_out = False
    try:
        output, _ = child.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGTERM)
        try:
            output, _ = child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            output, _ = child.communicate(timeout=3)
    text = output[:1024 * 1024].decode('utf-8', errors='replace')
    known = {
        'package_entrypoint_not_executable': 'resolved agent-node package entrypoint is not executable',
        'package_path_refused': 'resolved agent-node package has unsafe ownership or mode',
        'project_package_refused': 'project/node-local agent-node package payload is not trusted',
        'missing_dependency': 'Cannot find module',
        'missing_cli': 'not found on PATH',
        'unsupported_version': 'not compatible',
        'profile_refused': 'Refusing to start node',
        'unsafe_mcp_config': 'ensureMcpJson',
        'permission_denied': 'EACCES',
        'missing_file': 'ENOENT',
    }
    codes = sorted(code for code, marker in known.items() if marker in text)
    # No raw output exported: only recognized constants and stage/counter facts.
    result = {
        'test_only': True, 'app_source': os.environ['APP_SOURCE_COMMIT'],
        'backend_source': 'ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a',
        'cli_version': '2.3.0-preview.162', 'runtime_version': '2.5.0-preview.128',
        'survived_eight_seconds': timed_out, 'exit_code': child.returncode,
        'known_reasons': codes, 'hub_request_count': len(requests),
        'runtime_launch_marker': 'task timeout=' in text,
        'fixture_hub_rejects_all_requests': True, 'registration_tested': False,
        'native_ui_tested': False, 'model_tested': False,
    }
    Path('/evidence/cli-bootstrap.json').write_text(json.dumps(result, indent=2))
    print('CLI_BOOTSTRAP: ' + json.dumps(result), flush=True)
    assert not codes, 'actual CLI pre-Hub startup refused at a classified boundary'
    assert timed_out and requests, 'actual CLI did not survive to a request against rejecting fixture'
    print('PASS: actual CLI survives to rejecting HTTP fixture; NOT Hub registration/SSE/model proof', flush=True)
finally:
    if child is not None:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    server.shutdown()
    server.server_close()

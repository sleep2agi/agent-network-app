#!/usr/bin/python3
import json, os, pathlib, signal, sys, time
root = pathlib.Path(os.environ['ANET_TEST_ROOT'])
profile = root / 'local-daemon/.anet/nodes/local-daemon/config.json'
pidfile = profile.with_name('.pid')
args = sys.argv[1:]
if args == ['--version']:
    pkg = pathlib.Path(__file__).parent.parent / 'lib/node_modules/@sleep2agi/agent-network/package.json'
    print(json.loads(pkg.read_text())['version'])
    sys.exit(0)
cfg = json.loads(profile.read_text()) if profile.exists() else {}
def event(text):
    with (root / 'events').open('a') as f:
        f.write(text + '\n')
if args[:2] == ['node', 'stop']:
    event('stop ' + cfg['node_id'])
    mode = (root / 'stop-mode').read_text() if (root / 'stop-mode').exists() else 'ok'
    if mode == 'fail':
        print('fixture refuses to stop')
        sys.exit(1)
    if mode != 'lie':
        try: os.kill(int(pidfile.read_text()), signal.SIGTERM)
        except ProcessLookupError: pass
        pidfile.unlink(missing_ok=True)
elif args[:2] == ['daemon', 'init']:
    if pidfile.exists():
        try:
            os.kill(int(pidfile.read_text()), 0)
            raise AssertionError('init overwrote configuration before stop')
        except ProcessLookupError: pass
    event('init')
    profile.parent.mkdir(parents=True, exist_ok=True)
    old_id = cfg.get('node_id')
    cfg = json.loads((pathlib.Path(os.environ['HOME']) / '.anet/config.json').read_text())
    cfg['node_id'] = old_id or 'fixture-daemon-' + str(time.time_ns())
    profile.write_text(json.dumps(cfg))
    print('node_id: ' + cfg['node_id'])
elif args[:2] == ['daemon', 'start']:
    event('start')
    (root / 'start-env').write_text(os.environ.get('ANET_AGENT_NODE_BIN', ''))
    pidfile.write_text(str(os.getpid()))
    while True: time.sleep(1)
else:
    raise AssertionError(args)

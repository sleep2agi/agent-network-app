#!/usr/bin/python3
import json, os, pathlib, shutil, sys
root = pathlib.Path(os.environ['ANET_TEST_ROOT'])
if sys.argv[1:] == ['-v']:
    print('10.9.0')
    sys.exit(0)
args = sys.argv[1:]
prefix = pathlib.Path(args[args.index('--prefix') + 1])
spec = next(a for a in args if a.startswith('@sleep2agi/'))
name, version = spec.rsplit('@', 1)
assert version != 'latest', 'installer must choose its compatible version'
with (root / 'events').open('a') as f:
    f.write('npm ' + spec + '\n')
if (root / 'npm-mode').exists():
    sys.exit(0)
pkg = prefix / 'lib/node_modules' / name
(pkg / 'dist').mkdir(parents=True, exist_ok=True)
(pkg / 'package.json').write_text(json.dumps({'version': version}))
(pkg / 'dist/cli.js').write_text('fixture')
if name.endswith('/agent-network'):
    (prefix / 'bin').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / 'anet.py', prefix / 'bin/anet')
    (prefix / 'bin/anet').chmod(0o755)

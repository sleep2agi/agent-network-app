"""Offline CI wiring/negative-oracle contract; NOT native execution evidence."""
from copy import deepcopy
from pathlib import Path
import re
import subprocess
import yaml

workflow = yaml.load(Path('/fixture/workflow.yml').read_text(), Loader=yaml.BaseLoader)
source = 'ded59ce7417ed8b0d22290d9c6fcb6e5c3fb324a'
suite_dirs = ['linux-native-opencode-v1', 'linux-native-v1-registration',
              'linux-native-v1-model', 'linux-native-v1-candidate-runtime',
              'linux-native-v1-lifecycle', 'linux-native-v1-ci']
ordered = [
    'Checkout exact V1 backend candidate (TEST ONLY)',
    'Build source-bound V1 model and lifecycle fixtures (not registry acceptance)',
    'V1 environment authentication and session prerequisite',
    'Native V1 actual selected-model response (TEST ONLY candidate)',
    'Native V1 unavailable model refuses fallback and leaves no ACP child',
    'Native V1 wrong model oracle must reject an actual response',
    'Native V1 lifecycle and cancellation with fresh ACP replies',
    'Native V1 cancel oracle rejects actual stop confirmation',
    'Native V1 missed start remains stopped',
    'Preserve V1 candidate evidence and remove only owned test containers',
]
negatives = {
    ordered[5]: ('TEST_WRONG_MODEL=1',
                 'PASS: native-created V1 consumes fixture-only model response with safe ACP child',
                 'AssertionError: native V1 provider model mismatch'),
    ordered[7]: ('TEST_V1_CANCEL_SUBMIT=1',
                 'PASS: V1 lifecycle baseline bound to actual candidate worker/model reply',
                 'AssertionError: native V1 cancellation mutated lifecycle state'),
    ordered[8]: ('TEST_V1_START_MISS_CLICK=1',
                 'PASS: missed native V1 start preserved stopped identity/config/requests and absent worker',
                 'AssertionError: native V1 start confirmation did not apply'),
}


def check(doc):
    assert doc['permissions'] == {'contents': 'read'}, 'read-only permissions'
    for directory in suite_dirs:
        assert 'tests/' + directory + '/**' in doc['on']['pull_request']['paths'], 'suite path trigger'
    job = doc['jobs']['linux-deb']
    assert job['needs'] == 'v1-ci-contract', 'contract prerequisite'
    steps = job['steps']
    names = [step.get('name', '') for step in steps]
    assert all(names.count(name) == 1 for name in ordered), 'one of each V1 stage'
    indices = [names.index(name) for name in ordered]
    assert indices == sorted(indices), 'V1 gate order'
    assert names.index('Native V2 model switch and stop/start/restart') < indices[0], 'V2 before V1'
    selected = {name: steps[names.index(name)] for name in ordered}
    for name in ordered[:-1]:
        assert selected[name].get('if', 'success()') == 'success()', 'fail-closed prerequisite'
        assert selected[name].get('continue-on-error', 'false') == 'false', 'no ignored prerequisite'
    checkout = selected[ordered[0]]['with']
    assert checkout['ref'] == source and re.fullmatch('[0-9a-f]{40}', checkout['ref']), 'exact backend SHA'
    assert checkout['repository'] == 'sleep2agi/agent-network', 'backend repository'
    assert checkout['persist-credentials'] == 'false', 'no persisted credentials'
    build = selected[ordered[1]]['run']
    assert 'backend_sha=' + source in build, 'build backend binding'
    assert 'git -C v1-backend-source rev-parse HEAD' in build, 'checkout identity check'
    assert 'source_sha=$(git rev-parse HEAD)' in build and 'sha256sum out/*.deb' in build, 'actual app and deb binding'
    assert '--build-arg SOURCE_COMMIT="$source_sha" --build-arg DEB_SHA256="$deb_sha"' in build, 'fixture package binding'
    assert 'NOT registry clean install or release' in build, 'test-only manifest'
    created = []
    for name in ordered[2:-1]:
        run = selected[name]['run']
        assert '--network none --cap-drop ALL --security-opt no-new-privileges' in run, 'isolated execution'
        assert not re.search(r'--privileged|--network host|--volume|\s-v\s', run), 'no host access'
        created.extend(re.findall(r'--name (native-v1-[a-z-]+)', run))
        if name in negatives:
            switch, prerequisite, assertion = negatives[name]
            assert switch in run and 'test "$result" -eq 1' in run, 'precise negative exit'
            assert 'grep -F ' + repr(prerequisite) in run, 'negative prerequisite marker'
            assert 'grep -F ' + repr(assertion) in run, 'precise negative assertion'
        else:
            assert not re.search(r'\|\||set \+e', run), 'positive must propagate failure'
    assert len(created) == len(set(created)) == 7, 'seven independent containers'
    cleanup = selected[ordered[-1]]
    assert cleanup['if'] == 'always()', 'unconditional evidence cleanup'
    for container in created:
        assert container in cleanup['run'], 'all owned containers cleaned'
    assert 'docker cp "$name:/evidence/."' in cleanup['run'], 'redacted evidence only'
    assert 'docker rm -f "$name" || cleanup_failed=1' in cleanup['run'], 'cleanup on evidence failure'
    assert '{{.State.ExitCode}}' in cleanup['run'] and '{{.Image}}' in cleanup['run'], 'terminal identity evidence'
    assert 'test "$cleanup_failed" -eq 0' in cleanup['run'], 'cleanup failure surfaced'
    upload = steps[indices[-1] + 1]
    assert upload['uses'] == 'actions/upload-artifact@v4' and upload['if'] == 'always()', 'artifact after cleanup'
    assert upload['with']['name'].startswith('TEST-ONLY-'), 'test-only artifact'
    for step in steps:
        if 'run' in step:
            subprocess.run(['bash', '-n'], input=step['run'], text=True, check=True)


check(workflow)
for file in ['candidate.Dockerfile', 'manifest.mjs', 'model.Dockerfile']:
    assert source in Path('/fixture/' + file).read_text(), 'cross-fixture source binding'
print('PASS: actual workflow order, source/package binding, sandbox, oracles, cleanup and bash syntax')


def mutation(label, mutate, expected):
    broken = deepcopy(workflow)
    mutate(broken)
    try:
        check(broken)
    except AssertionError as error:
        assert str(error) == expected, (label, str(error))
        print('PASS: mutation rejected precisely: ' + label)
    else:
        raise AssertionError('mutation escaped: ' + label)


def step(doc, name):
    return next(s for s in doc['jobs']['linux-deb']['steps'] if s.get('name') == name)


mutation('missing trigger', lambda d: d['on']['pull_request']['paths'].remove('tests/linux-native-v1-model/**'), 'suite path trigger')
mutation('floating source', lambda d: step(d, ordered[0])['with'].update(ref='main'), 'exact backend SHA')
mutation('downstream always', lambda d: step(d, ordered[6]).update({'if': 'always()'}), 'fail-closed prerequisite')
mutation('ignored failure', lambda d: step(d, ordered[3]).update({'continue-on-error': 'true'}), 'no ignored prerequisite')
mutation('loose negative exit', lambda d: step(d, ordered[7]).update(run=step(d, ordered[7])['run'].replace('-eq 1', '-ne 0')), 'precise negative exit')
mutation('wrong assertion', lambda d: step(d, ordered[5]).update(run=step(d, ordered[5])['run'].replace('provider model mismatch', 'unrelated failure')), 'precise negative assertion')
mutation('conditional cleanup', lambda d: step(d, ordered[-1]).update({'if': 'success()'}), 'unconditional evidence cleanup')
mutation('missing cleanup target', lambda d: step(d, ordered[-1]).update(run=step(d, ordered[-1])['run'].replace('native-v1-start-missed', 'not-owned')), 'all owned containers cleaned')
print('PASS: 1 wiring contract and 8 adversarial mutations; NO native run or release claim')

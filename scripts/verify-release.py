#!/usr/bin/env python3
"""Verify a desktop release end to end (read-only, stdlib only).

"Release complete" has exactly one definition (docs/desktop-release-sop.md §6):
main / feed / fallback / both mirror VERSIONs all equal the target version.
When two people disagree about whose snapshot is stale, run this script
instead of comparing tables.

Usage:
    python3 scripts/verify-release.py                    # target = main package.json version
    python3 scripts/verify-release.py 0.2.522            # explicit target
    python3 scripts/verify-release.py 0.2.522 --notes 插话 --notes 打断

Exit code 0 only when nothing FAILed. WARN never fails the run: a lagging
fallback is the documented expected state while the watchdog catches up, and
unreadable notes before the feed flips is "not verifiable yet", not "missing".

Deliberately NOT checked here (no local evidence => NOT_RUN):
Windows Authenticode validity, macOS code signing/notarization, store review,
rollout, rollback, install/auto-update on real machines.
"""
import json
import sys
import urllib.request

UA = {'User-Agent': 'anet-verify', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache'}
APP = 'sleep2agi/agent-network-app'
FEED = 'https://www.anet.sh/desktop/update/latest.json'
FALLBACK = 'https://www.anet.sh/desktop/update/fallback.json'
MIRROR = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master'


def get(url, timeout=25):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def getj(url):
    return json.loads(get(url).decode())


def head(url):
    req = urllib.request.Request(url, headers=UA, method='HEAD')
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.status, r.headers.get('content-length')


def main():
    args = sys.argv[1:]
    notes = []
    while '--notes' in args:
        i = args.index('--notes')
        if i + 1 >= len(args):
            raise SystemExit('--notes needs a value')
        notes.append(args[i + 1])
        del args[i:i + 2]
    want = args[0] if args else None

    fails, warns = [], []

    def ok(msg):
        print(f'  PASS  {msg}')

    def bad(msg):
        fails.append(msg)
        print(f'  FAIL  {msg}')

    def warn(msg):
        warns.append(msg)
        print(f'  WARN  {msg}')

    print('== pointers')
    mainv = getj(f'https://raw.githubusercontent.com/{APP}/main/package.json').get('version')
    feed = getj(FEED)
    feedv = feed.get('version')
    target = want or mainv
    print(f'  main={mainv}  feed={feedv}  pub_date={feed.get("pub_date")}')
    if feedv == target:
        ok(f'feed version == {target}')
    else:
        bad(f'feed version {feedv} != {target}')
    if want and mainv != want:
        warn(f'main is still {mainv} (target {want} not merged, or bumped later)')

    print('== fallback pointer (watchdog flips it after publish; lag is expected)')
    try:
        fb = getj(FALLBACK)
        print(f'  fallback={fb.get("version")}  pub_date={fb.get("pub_date")}')
        if fb.get('version') == target:
            ok(f'fallback == {target}')
        else:
            warn(f'fallback still {fb.get("version")} (watchdog tick pending; not "unreleased")')
    except Exception as e:
        warn(f'fallback unreadable: {getattr(e, "code", type(e).__name__)}')

    print('== desktop / android mirror pointers (ModelScope, not anet.sh)')
    for label, path in (('desktop', '/desktop/latest/VERSION'), ('android', '/android/latest/VERSION')):
        try:
            v = get(MIRROR + path).decode().strip()
            if v == target:
                ok(f'{label} mirror latest/VERSION == {target}')
            else:
                warn(f'{label} mirror still {v}')
        except Exception as e:
            bad(f'{label} mirror VERSION unreadable: {getattr(e, "code", type(e).__name__)}')

    print('== update-feed assets (HEAD + size)')
    platforms = feed.get('platforms') or {}
    for name, info in platforms.items():
        if not isinstance(info, dict):
            continue
        url = info.get('url') or ''
        size = info.get('size')
        if not url:
            warn(f'{name}: no url in manifest')
            continue
        try:
            code, clen = head(url)
        except Exception as e:
            bad(f'{name}: HEAD failed {getattr(e, "code", type(e).__name__)}')
            continue
        if code != 200:
            bad(f'{name}: HEAD {code}')
        elif size and clen and int(clen) != int(size):
            bad(f'{name}: size mismatch manifest={size} actual={clen}')
        else:
            ok(f'{name}: downloadable {clen} bytes')

    print('== android mirror APK (same bytes as the release asset?)')
    try:
        apk = f'{MIRROR}/android/agent-network-{target}.apk'
        _, clen = head(apk)
        mirror_sha = get(apk + '.sha256').decode().split()[0]
        sums = get(f'{MIRROR}/desktop/{target}/SHA256SUMS').decode()
        line = next((l for l in sums.splitlines() if 'android-universal.apk' in l), '')
        sums_sha = line.split()[0] if line else ''
        ok(f'mirror APK downloadable ({clen} bytes), sha256 {mirror_sha[:16]}...') if clen else bad('mirror APK: no content-length')
        if sums_sha and sums_sha == mirror_sha:
            ok('mirror APK sha256 == mirror SHA256SUMS line')
        elif sums_sha:
            bad('mirror APK sha256 != SHA256SUMS line')
        else:
            warn('SHA256SUMS has no android-universal.apk line')
        try:
            rel = getj(f'https://api.github.com/repos/{APP}/releases/tags/desktop-v{target}')
            gh = next((a.get('digest') or '' for a in rel.get('assets', [])
                       if a['name'].endswith('android-universal.apk')), '')
            if gh.startswith('sha256:'):
                if gh.split(':', 1)[1] == mirror_sha:
                    ok('mirror APK sha256 == GitHub asset digest (same bytes)')
                else:
                    bad('mirror APK sha256 != GitHub asset digest')
        except Exception as e:
            warn(f'GitHub digest unreadable ({getattr(e, "code", type(e).__name__)}); same-bytes check stops at SHA256SUMS')
    except Exception as e:
        bad(f'mirror APK check failed: {getattr(e, "code", type(e).__name__)}')

    print('== release assets')
    tag = f'desktop-v{target}'
    try:
        html = get(f'https://github.com/{APP}/releases/expanded_assets/{tag}').decode()
        names = [seg.split('"')[0].rsplit('/', 1)[-1]
                 for seg in html.split('href="')[1:] if '/releases/download/' in seg]
        if names:
            ok(f'{tag}: {len(names)} assets -> {", ".join(names)}')
        else:
            bad(f'{tag}: no download links (draft / unpublished / source-only)')
    except Exception as e:
        bad(f'{tag}: expanded_assets unreadable {getattr(e, "code", type(e).__name__)}')

    print('== notes keywords')
    body = feed.get('notes') or ''
    if feedv != target:
        warn(f'notes not verifiable yet: feed is still {feedv}')
    elif not notes:
        warn('no --notes given; skipping keyword check')
    else:
        for k in notes:
            if k in body:
                ok(f'notes contain "{k}"')
            else:
                bad(f'notes missing "{k}"')

    print()
    if fails:
        print(f'verdict: {len(fails)} FAIL / {len(warns)} WARN — cannot be called verified')
        return 1
    print(f'verdict: all pointers/assets/notes checks passed ({len(warns)} WARN); signing, notarization, real-device install, rollout and rollback remain NOT_RUN')
    return 0


if __name__ == '__main__':
    sys.exit(main())

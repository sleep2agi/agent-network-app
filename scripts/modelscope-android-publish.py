#!/usr/bin/env python3
"""Publish one Android APK to the ModelScope android channel (see src/android-update-core.ts header).

  publish --apk FILE --version X.Y.Z [--dry-run]

writes, in ONE commit to the dataset:

  android/agent-network-<ver>.apk           the APK (skipped when the mirror already holds these bytes)
  android/agent-network-<ver>.apk.sha256    `sha256sum` line: "<64 hex>  agent-network-<ver>.apk\\n"
  android/latest/VERSION                    "<ver>\\n"  —— what the in-app updater reads

then verifies ANONYMOUSLY (no token — what a phone in China gets): VERSION and the sha file byte for
byte, and a full download of the APK compared by sha256. The release is not visible to the updater
until this passes.

android/latest/VERSION only moves forward: publishing a version lower than the one it holds is
refused (the same version again is an idempotent re-run).

The token is read from $MODELSCOPE_API_TOKEN and is never printed. Upload and listing helpers are
shared with scripts/modelscope-mirror-upload.py.
"""
import argparse
import hashlib
import importlib.util
import os
import re
import shutil
import sys
import tempfile
import urllib.error

_spec = importlib.util.spec_from_file_location(
    'mirror_upload', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'modelscope-mirror-upload.py'))
mirror = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mirror)

VERSION_RE = re.compile(r'^\d+\.\d+\.\d+$')


def apk_name(version):
    return f'agent-network-{version}.apk'


def parse_version(text):
    text = (text or '').strip()
    return tuple(int(x) for x in text.split('.')) if VERSION_RE.match(text) else None


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def current_channel_version(repo):
    """android/latest/VERSION as anonymous users see it; None when the channel does not exist yet."""
    try:
        status, body = mirror.http_get(mirror.resolve_url(repo, 'android/latest/VERSION'))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    version = body.decode('utf-8', 'replace').strip()
    if status != 200 or not parse_version(version):
        raise SystemExit(f'::error::android/latest/VERSION on the mirror is not a version (HTTP {status}); fix it by hand first')
    return version


def cmd_publish(args):
    version = args.version.strip()
    if not parse_version(version):
        raise SystemExit(f'::error::--version must be X.Y.Z, got {version!r}')
    if not os.path.isfile(args.apk):
        raise SystemExit(f'::error::no such APK: {args.apk}')

    name = apk_name(version)
    sha = sha256_file(args.apk)
    size = os.path.getsize(args.apk)
    log = mirror.log
    log(f'{name}: {size} bytes, sha256 {sha}')

    held = current_channel_version(args.repo)
    log(f'android/latest/VERSION on the mirror: {held or "(none yet)"}')
    if held and parse_version(held) > parse_version(version):
        raise SystemExit(f'::error::android/latest/VERSION is {held}, refusing to move it back to {version}')

    listing = mirror.retry('anonymous listing', lambda: mirror.anonymous_listing(args.repo))
    apk_path = f'android/{name}'
    held_sha = listing.get(apk_path)
    if held_sha and held_sha != sha:
        # Same version, different bytes: a phone that already downloaded the old file would fail its check,
        # and it breaks "one version = one APK". Needs a human decision (new version number).
        raise SystemExit(f'::error::{apk_path} already exists on the mirror with a different sha256 ({held_sha}); bump the version instead')

    sha_text = f'{sha}  {name}\n'.encode()
    version_text = f'{version}\n'.encode()
    files = {f'android/{name}.sha256': sha_text, 'android/latest/VERSION': version_text}
    expected = {apk_path: sha, **{p: hashlib.sha256(b).hexdigest() for p, b in files.items()}}

    staging = tempfile.mkdtemp(prefix='anet-android-publish-')
    try:
        tree = os.path.join(staging, 'tree')
        for path, body in files.items():
            if listing.get(path) == expected[path]:
                continue
            os.makedirs(os.path.dirname(os.path.join(tree, path)), exist_ok=True)
            with open(os.path.join(tree, path), 'wb') as handle:
                handle.write(body)
        if held_sha != sha:
            os.makedirs(os.path.join(tree, 'android'), exist_ok=True)
            shutil.copyfile(args.apk, os.path.join(tree, apk_path))
        staged = sorted(
            os.path.relpath(os.path.join(root, n), tree).replace(os.sep, '/')
            for root, _, names in os.walk(tree) for n in names
        ) if os.path.isdir(tree) else []
        log(f'to upload: {", ".join(staged) if staged else "(nothing — already in sync)"}')
        if args.dry_run:
            log('dry run: not uploading, not verifying')
            return
        if staged:
            token = os.environ.get('MODELSCOPE_API_TOKEN', '')
            if not token:
                raise SystemExit('::error::MODELSCOPE_API_TOKEN is not set (repository secret)')
            from modelscope.hub.api import HubApi
            api = HubApi()
            mirror.retry('login', lambda: api.login(token))
            mirror.retry('upload_folder', lambda: api.upload_folder(
                repo_id=args.repo,
                folder_path=tree,
                path_in_repo='',
                repo_type=mirror.REPO_TYPE,
                commit_message=f'android {version}: {len(staged)} file(s)',
                use_cache=False,
            ), attempts=3, delay=30)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    verify(args.repo, version, expected, files)


def verify(repo, version, expected, files):
    log = mirror.log

    def listing_matches():
        listing = mirror.anonymous_listing(repo)
        bad = sorted(p for p, s in expected.items() if listing.get(p) != s)
        if bad:
            raise RuntimeError(f'{len(bad)} path(s) differ on the mirror: ' + ', '.join(bad))
    mirror.retry('verify listing', listing_matches, attempts=5, delay=10)
    log(f'listing: all {len(expected)} path(s) present with the expected sha256')

    for path, body in files.items():
        def small():
            status, got = mirror.http_get(mirror.resolve_url(repo, path))
            if status != 200 or got != body:
                raise RuntimeError(f'{path}: HTTP {status}, {len(got)} byte(s), not the published content')
        mirror.retry(f'anonymous GET {path}', small, attempts=4, delay=10)
        log(f'  ok  {path} (anonymous download, byte for byte)')

    apk_path = f'android/{apk_name(version)}'

    def full_apk():
        status, got = mirror.http_get(mirror.resolve_url(repo, apk_path))
        actual = hashlib.sha256(got).hexdigest()
        if status != 200 or actual != expected[apk_path]:
            raise RuntimeError(f'{apk_path}: HTTP {status}, sha256 {actual}')
    mirror.retry(f'anonymous GET {apk_path}', full_apk, attempts=3, delay=20)
    log(f'  ok  {apk_path} (anonymous full download, sha256 match)')
    log(f'android channel verified: the in-app updater now sees {version}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['publish'])
    parser.add_argument('--repo', default=os.environ.get('MODELSCOPE_MIRROR_REPO', mirror.DEFAULT_REPO))
    parser.add_argument('--apk', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    cmd_publish(args)


if __name__ == '__main__':
    sys.exit(main())

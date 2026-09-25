#!/usr/bin/env python3
"""ModelScope side of the desktop release mirror (see scripts/modelscope-mirror.mjs).

  list   --out remote.json               anonymous listing: {path: sha256} of the dataset
  upload --dir DIR                       commit DIR/tree (only the changed files) in ONE
                                         commit, then verify every path in DIR/expected.json
                                         anonymously: listing sha256 for all of them, plus a
                                         byte-for-byte download of the small ones.

The token is read from $MODELSCOPE_API_TOKEN and is never printed. Listing and
verification deliberately run WITHOUT the token: what matters is what an anonymous
user in China gets, not what the uploader can see.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request

REPO_TYPE = 'dataset'
DEFAULT_REPO = 'SmartFlowAI/agent-network-releases'
# Files at or under this size are downloaded anonymously and compared byte for byte.
# Larger ones are checked through the listing sha256 and a ranged GET (reachability).
FULL_VERIFY_MAX_BYTES = 1024 * 1024


def log(message):
    print(message, flush=True)


def retry(label, fn, attempts=4, delay=15):
    last = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as error:  # noqa: BLE001 - SDK raises many types
            last = error
            # Never echo request details: SDK errors can carry headers.
            log(f'::warning::{label} failed (attempt {attempt}/{attempts}): {type(error).__name__}: {str(error)[:300]}')
            if attempt < attempts:
                time.sleep(delay * attempt)
    raise SystemExit(f'::error::{label}: giving up after {attempts} attempts ({type(last).__name__})')


def anonymous_listing(repo):
    from modelscope_hub.api import HubApi
    api = HubApi(token=None)
    files = api.list_repo_files(repo, REPO_TYPE)
    return {f.path: f.sha256 for f in files if not f.is_dir and f.sha256}


def resolve_url(repo, path):
    return f'https://modelscope.cn/datasets/{repo}/resolve/master/{path}'


def http_get(url, headers=None, limit=None):
    request = urllib.request.Request(url, headers={'User-Agent': 'anet-modelscope-mirror', **(headers or {})})
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read(limit) if limit else response.read()
        return response.status, body


def cmd_list(args):
    listing = retry('anonymous listing', lambda: anonymous_listing(args.repo))
    with open(args.out, 'w') as handle:
        json.dump(listing, handle, indent=2, sort_keys=True)
    log(f'{args.repo}: {len(listing)} file(s) on the mirror')


def cmd_upload(args):
    tree = os.path.join(args.dir, 'tree')
    with open(os.path.join(args.dir, 'expected.json')) as handle:
        expected = json.load(handle)
    with open(os.path.join(args.dir, 'summary.json')) as handle:
        summary = json.load(handle)

    staged = sorted(
        os.path.relpath(os.path.join(root, name), tree).replace(os.sep, '/')
        for root, _, names in os.walk(tree) for name in names
    )
    if staged:
        token = os.environ.get('MODELSCOPE_API_TOKEN', '')
        if not token:
            raise SystemExit('::error::MODELSCOPE_API_TOKEN is not set (repository secret)')
        from modelscope.hub.api import HubApi
        api = HubApi()
        retry('login', lambda: api.login(token))
        message = f"mirror {summary['tag']}: {len(staged)} file(s)"
        log(f'uploading {len(staged)} file(s) in one commit: {message}')
        retry('upload_folder', lambda: api.upload_folder(
            repo_id=args.repo,
            folder_path=tree,
            path_in_repo='',
            repo_type=REPO_TYPE,
            commit_message=message,
            use_cache=False,
        ), attempts=3, delay=30)
    else:
        log(f"{summary['tag']}: already in sync, nothing to upload")

    # --- anonymous verification of EVERY expected path, not just the uploaded ones ---
    def listing_matches():
        listing = anonymous_listing(args.repo)
        bad = sorted(p for p, sha in expected.items() if listing.get(p) != sha)
        if bad:
            raise RuntimeError(f'{len(bad)} path(s) differ on the mirror: ' + ', '.join(bad[:10]))
        return listing
    retry('verify listing', listing_matches, attempts=5, delay=10)
    log(f'listing: all {len(expected)} expected path(s) present with the expected sha256')

    sizes = summary.get('sizes') or {}
    for path, sha in sorted(expected.items()):
        url = resolve_url(args.repo, path)
        if sizes.get(path, 0) <= FULL_VERIFY_MAX_BYTES or path.endswith(('.json', '.sig', 'SHA256SUMS', 'VERSION')):
            def fetch_and_compare():
                status, body = http_get(url)
                actual = hashlib.sha256(body).hexdigest()
                if status != 200 or actual != sha:
                    raise RuntimeError(f'{path}: HTTP {status}, sha256 {actual}')
            retry(f'anonymous GET {path}', fetch_and_compare, attempts=4, delay=10)
            log(f'  ok  {path} (anonymous download, sha256 match)')
        else:
            def reachable():
                status, _ = http_get(url, headers={'Range': 'bytes=0-1023'}, limit=1024)
                if status not in (200, 206):
                    raise RuntimeError(f'{path}: HTTP {status}')
            retry(f'anonymous ranged GET {path}', reachable, attempts=4, delay=10)
            log(f'  ok  {path} (anonymous ranged GET; sha256 via listing)')
    log(f"mirror verified for {summary['tag']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['list', 'upload'])
    parser.add_argument('--repo', default=os.environ.get('MODELSCOPE_MIRROR_REPO', DEFAULT_REPO))
    parser.add_argument('--out')
    parser.add_argument('--dir')
    args = parser.parse_args()
    if args.command == 'list':
        if not args.out:
            parser.error('--out is required')
        cmd_list(args)
    else:
        if not args.dir:
            parser.error('--dir is required')
        cmd_upload(args)


if __name__ == '__main__':
    sys.exit(main())

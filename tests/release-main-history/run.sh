#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
git init -q -b main "$work/source"
git -C "$work/source" config user.name Fixture
git -C "$work/source" config user.email fixture@example.invalid
git -C "$work/source" commit -q --allow-empty -m release
release=$(git -C "$work/source" rev-parse HEAD)
git -C "$work/source" commit -q --allow-empty -m later-main
git clone -q "file://$work/source" "$work/old"
git -C "$work/old" fetch -q origin main --depth=1
if git -C "$work/old" merge-base --is-ancestor "$release" origin/main; then
  echo "FAIL: old shallow fetch unexpectedly retained ancestry"; exit 1
fi
echo "PASS: reproduced old false rejection after main advanced"
git clone -q "file://$work/source" "$work/fixed"
git -C "$work/fixed" checkout -q "$release"
git -C "$work/fixed" fetch -q origin main
git -C "$work/fixed" merge-base --is-ancestor "$release" origin/main
echo "PASS: full-history fetch accepts merged release ancestor"
git -C "$work/fixed" config user.name Fixture
git -C "$work/fixed" config user.email fixture@example.invalid
git -C "$work/fixed" commit -q --allow-empty -m unmerged
unmerged=$(git -C "$work/fixed" rev-parse HEAD)
if git -C "$work/fixed" merge-base --is-ancestor "$unmerged" origin/main; then
  echo "FAIL: unmerged commit accepted"; exit 1
fi
echo "PASS: unmerged commit remains rejected"

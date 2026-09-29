# Phone board column width

Owner 2026-09-29, Android 0.2.143: 任务 → 看板 showed three ~10px vertical slivers.

Cause (native only): the phone column style was `s.column` (`flex: 1, flexBasis: 0`) plus
`{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width }`. react-native-web expands `flex` into CSS
longhands and the later ones win, so web measured 330. Native Yoga keeps `flex` as its own field and,
when `flexBasis` is auto and `flex > 0`, resolves the basis to 0 and ignores `width`: each column is its
4px border and the scroll content container is 32px (reproduced with `yoga-layout`).

Guards:

- `src/task-board-layout.test.ts` (runs in `npm test`): width model (0/undefined container width falls
  back to the window width, phone columns never under 240dp) and a static check that the horizontal
  paged ScrollView has no `flex` / `flexBasis` / percentage widths.
- this fixture (not in CI: Playwright + Chromium): 390×844 Android UA, normal and `?zeroLayout=1`
  (ResizeObserver stubbed out so `onLayout` never reports a width). Asserts every column ≥ 300 (358),
  each tab brings its column on screen with its card visible, list rows ≥ 300, rotate to 844 gives three
  equal columns and back to 390 pages again, foldable 884 has three equal columns.
  Against main it fails (21 checks, 6 pass; zero-layout columns are 103px).

Web cannot reproduce the native collapse itself, so this still needs a check on a real Android phone.

From repo root:

```sh
sg docker -c 'docker build -f tests/test-phone-board/Dockerfile -t anet-phone-board:review .'
mkdir -p /tmp/anet-phone-board-output
sg docker -c 'docker run --rm -v /tmp/anet-phone-board-output:/output anet-phone-board:review'
sg docker -c 'docker run --rm -v /tmp/anet-phone-board-output:/output -v "$PWD/tests/test-phone-board:/spec:ro" mcr.microsoft.com/playwright:v1.58.2-noble sh -c "npm install --prefix /tmp/runner --no-audit --no-fund playwright@1.58.2 >/dev/null && PLAYWRIGHT_MODULE=/tmp/runner/node_modules/playwright/index.mjs node /spec/drive.mjs"'
```

# Child Tag Browser Regression

Run from `client-app` after the parent agent exports the web App:

```sh
node tests/child-tag-ui/verify.mjs
```

Uses the existing Playwright installation and local Google Chrome, as in
`tests/agent-org-ui`. Set `PLAYWRIGHT_MODULE` to an absolute Playwright module
path or `WEB_DIR` to another existing export when needed. No build, installation,
production accounts, production writes, or source changes are performed.

The unchanged full App is served on a random loopback port. The scheduler fixture's
read-only desktop bootstrap supplies a fake local profile and HTTP bridge; this
fixture adds language selection. HTTP requests are restricted by CSP and browser
routing to the fixture origin, sockets are disabled, and unexpected API writes
are rejected and recorded. A stale export fails the browser's child-tag selectors.

Desktop/mobile, Chinese/light and English/dark cases cover the real sidebar
right-click or touch-mode long-press menu, initial parent, searchable parents,
dialog/list/footer bounds, cancel without writes, exact atomic creation payload,
zero-task node discovery after reload, localized 403/404 parent-missing/409 errors,
and #2164 old-Hub behavior: child creation is absent from the menu, manager
creation is absent, existing rename/color/delete actions remain visible, and
browsing performs zero writes. A seeded child, grandchild and unrelated task
verify that a parent filter includes descendants with `nodes` metadata, but
matches only its direct task on a flat legacy Hub. Clearing the filter restores
all four tasks; desktop legacy tags also retain equal flat indentation.
The mobile long press uses a held browser pointer on the touch-mode Pressable.

`artifacts/report.json` records individual checks, bundle hashes, errors, blocked
requests and screenshots. Per-case server-state JSON includes the complete API
request/write ledger. Screenshots and artifacts are generated locally and ignored.
Exit status is nonzero for any failed check or scenario.

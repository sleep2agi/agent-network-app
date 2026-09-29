# Task GitHub associations

Run from the repo root; tests use isolated Docker and a temporary HTTP fixture,
never the production Hub. The fixture rejects issue13 with `invalid_issues`,
then accepts issue14; it records exact PATCH bodies and returns normalized Hub
objects. Browser checks cover board/list counts, link/unlink, source identity,
external opening, error recovery and measured controls on both viewports.

```sh
sg docker -c 'docker build -f tests/test-task-issues/Dockerfile -t anet-task-issues:review .'
sg docker -c 'docker run --rm anet-task-issues:review npm test'
sg docker -c 'docker build -f tests/requirement-details/Dockerfile -t anet-issue-components .'
sg docker -c 'docker run --rm anet-issue-components'
mkdir -p /tmp/anet-task-issues
sg docker -c 'docker run --rm -v /tmp/anet-task-issues:/output anet-task-issues:review'
sg docker -c 'docker run --rm --ipc=host -v "$PWD":/app:ro -v /tmp/anet-task-issues:/output -w /tmp/runner mcr.microsoft.com/playwright:v1.58.2-noble sh -c "npm install --no-audit --no-fund playwright@1.58.2 && PLAYWRIGHT_MODULE=/tmp/runner/node_modules/playwright/index.mjs node /app/tests/test-task-issues/drive.mjs"'
```

Browser bundle reuses the task-language Board fixture. Real data/model/API paths
are loaded; only the HTTP server and external-window destination are replaced.
Responsive-web screenshots are not native installer/device acceptance.

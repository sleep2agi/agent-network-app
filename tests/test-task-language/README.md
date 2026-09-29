# Task-page language smoke

Run from the repository root. All execution is isolated in Docker; HTTP responses
come from a read-only fixture, never a running Hub.

```sh
sg docker -c 'docker build -f tests/test-task-language/Dockerfile -t anet-task-language:review .'
sg docker -c 'docker run --rm anet-task-language:review npm test'
mkdir -p /tmp/task-language-output
sg docker -c 'docker run --rm -v /tmp/task-language-output:/output anet-task-language:review'
sg docker -c 'docker run --rm --ipc=host -v "$PWD":/app:ro -v /tmp/task-language-output:/output -w /tmp/runner mcr.microsoft.com/playwright:v1.58.2-noble sh -c "npm install --no-audit --no-fund playwright@1.58.2 && PLAYWRIGHT_MODULE=/tmp/runner/node_modules/playwright/index.mjs node /app/tests/test-task-language/drive.mjs"'
```

The driver checks 1200×800 and 390×844, measures alignment/viewport containment,
switches language with an unsaved draft, and requires zero Hub writes. Screenshots
are responsive-web evidence, not native device or installer acceptance.

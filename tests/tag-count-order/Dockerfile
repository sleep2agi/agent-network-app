FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /qa
COPY src ./src
CMD ["sh", "-c", "bun src/task-tag-catalog.test.ts && bun src/task-side-menu.test.ts && bun src/task-board-model.test.ts && bun src/requirement-tags.test.ts"]

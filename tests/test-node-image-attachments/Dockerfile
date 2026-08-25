FROM oven/bun:1.3.14
ARG SOURCE_COMMIT=unrecorded
LABEL anet.issue173.source_commit=$SOURCE_COMMIT
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["sh", "tests/test-node-image-attachments/run.sh"]

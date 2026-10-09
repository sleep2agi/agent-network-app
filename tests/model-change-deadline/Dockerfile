# Local Docker rendered regression; test-only dependency image, not a release.
ARG DEPENDENCY_IMAGE=anet-app-v2:deadline-e19
FROM ${DEPENDENCY_IMAGE}
WORKDIR /app
RUN cp package-lock.json /tmp/dependency-lock.json && rm -rf /app/src /app/tests /app/scripts /app/.github
COPY . .
RUN cmp package-lock.json /tmp/dependency-lock.json
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN npm run typecheck && npx expo export --platform web --output-dir /web-model
ENV WEB_DIR=/web-model OUT=/artifacts
ENTRYPOINT ["node", "tests/model-change-deadline/drive.mjs"]

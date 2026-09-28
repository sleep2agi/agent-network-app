FROM oven/bun:1.3.1@sha256:9c5d3c92b234b4708198577d2f39aab7397a242a40da7c2f059e51b9dc62b408
WORKDIR /qa
RUN bun add --exact react@19.2.3 react-test-renderer@19.2.3
COPY src ./src
COPY tests/requirement-details/details.test.tsx ./details.test.tsx
CMD ["bun", "test", "details.test.tsx"]

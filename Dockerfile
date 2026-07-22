FROM oven/bun:1

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY api-keys.json ./

ENV LLM_MOCK_PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["bun", "-e", "const res = await fetch(`http://localhost:${process.env.LLM_MOCK_PORT ?? 3000}/health`); if (!res.ok) process.exit(1);"]

USER bun
CMD ["bun", "src/index.ts"]

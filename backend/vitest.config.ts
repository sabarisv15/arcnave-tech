import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globalSetup: process.env.SKIP_DB === '1' ? [] : ['src/test/global-setup.ts'],
    // Nothing in this suite may reach a provider. Integration tests inject `FakeProvider` for
    // every slot in the service container; there is deliberately no path that spends Vertex
    // quota, whatever environment the suite is run in.
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    // Integration files each hold a connection pool and share one database. Serialising them
    // keeps the connection count low and makes a failure's cause obvious; the suite is fast
    // enough that the parallelism is not worth the ambiguity.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

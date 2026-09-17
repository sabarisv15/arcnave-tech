import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Nothing in this suite may reach a provider. Tests that need a model use a fake from the
    // service container; there is deliberately no path that spends Vertex quota.
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});

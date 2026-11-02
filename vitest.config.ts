import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/phase*/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    fileParallelism: false,
    testTimeout: 45000,
    hookTimeout: 45000
  }
});

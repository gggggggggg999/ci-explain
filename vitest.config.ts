import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some tests spawn npm/tsx/node processes; give slow machines room.
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
});

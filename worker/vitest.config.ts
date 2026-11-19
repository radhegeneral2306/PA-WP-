import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Chat switches are off in tests unless a test turns them on (see test/setup.ts).
    setupFiles: ["./test/setup.ts"],
  },
});

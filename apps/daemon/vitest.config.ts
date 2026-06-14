import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@open-codex/git": fileURLToPath(
        new URL("../../packages/git/src/index.ts", import.meta.url),
      ),
      "@open-codex/storage": fileURLToPath(
        new URL("../../packages/storage/src/index.ts", import.meta.url),
      ),
    },
  },
});

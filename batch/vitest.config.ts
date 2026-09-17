import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // ビルド済みdistではなくソースを直接参照し、テスト実行にビルドを不要にする
      "@pmreport/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});

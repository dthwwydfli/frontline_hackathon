import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(
        new URL("../../packages/common-thread-core/src", import.meta.url),
      ),
    },
  },
});

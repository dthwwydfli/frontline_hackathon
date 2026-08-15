import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { commonThreadRelay } from "./relay/plugin";

export default defineConfig({
  plugins: [react(), commonThreadRelay()],
  resolve: {
    alias: {
      "@core": fileURLToPath(
        new URL("../../packages/common-thread-core/src", import.meta.url),
      ),
    },
  },
  // Phones on the demo hotspot need to reach this machine, not just loopback.
  // `allowedHosts` also lets a tunnel (Pinggy, localtunnel, ngrok) forward to
  // this server — Vite otherwise rejects the tunnel's Host header with
  // "Blocked request. This host is not allowed."
  server: { host: "0.0.0.0", allowedHosts: true },
  preview: { host: "0.0.0.0", allowedHosts: true },
});

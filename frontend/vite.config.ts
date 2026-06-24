import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The Zama relayer SDK loads WASM (tfhe / tkms). Cross-origin isolation headers enable the
// threaded WASM path (SharedArrayBuffer). Applied to both the dev and preview servers.
function crossOriginIsolation(): Plugin {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setHeaders = (_req: any, res: any, next: any) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  };
  return {
    name: "cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use(setHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(setHeaders);
    },
  };
}

export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
  define: { global: "globalThis" },
  optimizeDeps: {
    // The SDK ships its own WASM glue; let it resolve at runtime rather than pre-bundling.
    exclude: ["@zama-fhe/relayer-sdk"],
  },
});

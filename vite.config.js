import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    // The Atlas WebGL canvas and fragment transform workspace are intentionally
    // lazy route/canvas chunks. Keep the warning below a size that would signal
    // real growth while avoiding noise for the current isolated bundles.
    chunkSizeWarningLimit: 650,
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "./node_modules/react"),
      "react/jsx-runtime": path.resolve(__dirname, "./node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "./node_modules/react/jsx-dev-runtime.js"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "react-dom/client": path.resolve(__dirname, "./node_modules/react-dom/client.js"),
    },
  },
});

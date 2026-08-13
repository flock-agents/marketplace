import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3456",
    },
  },
});

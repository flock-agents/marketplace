import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": the app is served under /a/<id>/, so asset paths must be relative.
export default defineConfig({ base: "./", plugins: [react()] });

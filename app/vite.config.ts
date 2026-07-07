import { defineConfig } from "vite";

// Relative base so the same bundle works on GitHub Pages project sites
// (/DiodeToyTuner/), Cloudflare Pages, or any static host.
export default defineConfig({ base: "./" });

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served under dotrobin.xyz/nest/ (own Caddy path); moves to nest.dotrobin.xyz
// once DNS exists — base stays relative-safe either way.
export default defineConfig({
  base: "/nest/",
  plugins: [react()],
});

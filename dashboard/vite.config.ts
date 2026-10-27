/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

const DEFAULT_API = "https://pa-wp-bot.radhegeneral2306.workers.dev";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiOrigin = new URL(env.VITE_API_BASE || DEFAULT_API).origin;

  return {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon-64.png", "apple-touch-icon.png"],
        manifest: {
          name: "Radhe Tasks",
          short_name: "Tasks",
          description: "Radhe Tiles World ke tasks ek jagah.",
          lang: "en-IN",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          theme_color: "#f6f6f7",
          background_color: "#f6f6f7",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // App shell only. Task data is never cached.
          globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: new RegExp("^" + escapeRegExp(apiOrigin) + "/"),
              handler: "NetworkOnly",
            },
            {
              urlPattern: /\/api\//,
              handler: "NetworkOnly",
            },
          ],
        },
      }),
    ],
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  };
});

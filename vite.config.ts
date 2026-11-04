import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { applyBrand, resolveAppName } from "./src/lib/brandText";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Product name (VITE_APP_NAME, default "min-tid") into index.html and manifest.webmanifest.
// The React code reads the same variable through src/lib/brand.ts.
function brand(name: string): Plugin {
  const manifest = "manifest.webmanifest";
  return {
    name: "brand",
    transformIndexHtml: (html) => applyBrand(html, name),
    configureServer(server) {
      server.middlewares.use(`/${manifest}`, (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(
          applyBrand(readFileSync(new URL(`./public/${manifest}`, import.meta.url), "utf8"), name),
        );
      });
    },
    writeBundle(options) {
      const out = `${options.dir ?? "dist"}/${manifest}`;
      if (existsSync(out)) writeFileSync(out, applyBrand(readFileSync(out, "utf8"), name));
    },
  };
}

export default defineConfig(({ mode }) => {
  const appName = resolveAppName(loadEnv(mode, process.cwd(), "VITE_").VITE_APP_NAME);
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      brand(appName),
      TanStackRouterVite({ routesDirectory: "./src/routes" }),
      react(),
      tailwindcss(),
      tsconfigPaths(),
    ],
    server: {
      host: "0.0.0.0",
      port: 5000,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
  };
});

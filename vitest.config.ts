import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Day keys are local dates, so tests must run in the app's real timezone
// regardless of the machine's (CI runners default to UTC).
process.env.TZ = "Europe/Stockholm";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.{js,mjs}"],
    env: { TZ: "Europe/Stockholm" },
    passWithNoTests: true,
  },
});

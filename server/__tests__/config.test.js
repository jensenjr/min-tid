import { describe, expect, it } from "vitest";
import { DEV_JWT_SECRET, resolveServerConfig } from "../config.js";

const SECRET = "x".repeat(40);
const dir = "/srv/app/server";

describe("resolveServerConfig — storage", () => {
  it("development: data.json next to the server, storage unknown, dev secret allowed", () => {
    const c = resolveServerConfig({}, dir);
    expect(c.prod).toBe(false);
    expect(c.port).toBe(3001);
    expect(c.dataPath).toMatch(/data\.json$/);
    expect(c.storage).toBe("unknown");
    expect(c.jwtSecret).toBe(DEV_JWT_SECRET);
    expect(c.fatal).toEqual([]);
  });

  it("Railway with a volume: stores on the volume and reports persistent", () => {
    const c = resolveServerConfig(
      {
        NODE_ENV: "production",
        JWT_SECRET: SECRET,
        RAILWAY_ENVIRONMENT_NAME: "production",
        RAILWAY_VOLUME_MOUNT_PATH: "/app/data",
      },
      dir,
    );
    expect(c.dataPath).toBe("/app/data/data.json");
    expect(c.storage).toBe("persistent");
    expect(c.warnings).toEqual([]);
    expect(c.port).toBe(3000);
  });

  it("Railway volume at another path is picked up without setting DATA_PATH", () => {
    const c = resolveServerConfig(
      {
        NODE_ENV: "production",
        JWT_SECRET: SECRET,
        RAILWAY_PROJECT_ID: "p",
        RAILWAY_VOLUME_MOUNT_PATH: "/data",
      },
      dir,
    );
    expect(c.dataPath).toBe("/data/data.json");
    expect(c.storage).toBe("persistent");
  });

  it("Railway without a volume: ephemeral, with a loud warning (the redeploy-wipes-accounts case)", () => {
    const c = resolveServerConfig(
      { NODE_ENV: "production", JWT_SECRET: SECRET, RAILWAY_ENVIRONMENT: "production" },
      dir,
    );
    expect(c.dataPath).toBe("/app/data/data.json");
    expect(c.storage).toBe("ephemeral");
    expect(c.warnings.join(" ")).toMatch(/FÖRSVINNER VID NÄSTA DEPLOY/);
    expect(c.fatal).toEqual([]);
  });

  it("DATA_PATH outside the volume is ephemeral too", () => {
    const c = resolveServerConfig(
      {
        NODE_ENV: "production",
        JWT_SECRET: SECRET,
        RAILWAY_SERVICE_ID: "s",
        RAILWAY_VOLUME_MOUNT_PATH: "/data",
        DATA_PATH: "/app/data/data.json",
      },
      dir,
    );
    expect(c.storage).toBe("ephemeral");
    expect(c.warnings.join(" ")).toMatch(/utanför volymen/);
  });

  it("docker-compose style: DATA_PERSISTENT=1 marks a bind mount as persistent", () => {
    const c = resolveServerConfig(
      {
        NODE_ENV: "production",
        JWT_SECRET: SECRET,
        DATA_PATH: "/app/data/data.json",
        DATA_PERSISTENT: "1",
      },
      dir,
    );
    expect(c.storage).toBe("persistent");
  });
});

describe("resolveServerConfig — JWT_SECRET", () => {
  for (const [label, value] of [
    ["missing", undefined],
    ["the dev default", DEV_JWT_SECRET],
    ["the compose placeholder", "change-this-to-a-long-random-string-in-production"],
    ["too short", "short-secret"],
  ]) {
    it(`production refuses to start when it is ${label}`, () => {
      const env = { NODE_ENV: "production" };
      if (value !== undefined) env.JWT_SECRET = value;
      const c = resolveServerConfig(env, dir);
      expect(c.fatal.join(" ")).toMatch(/JWT_SECRET/);
    });
  }

  it("a long random secret is accepted and used", () => {
    const c = resolveServerConfig({ NODE_ENV: "production", JWT_SECRET: SECRET }, dir);
    expect(c.fatal).toEqual([]);
    expect(c.jwtSecret).toBe(SECRET);
  });
});

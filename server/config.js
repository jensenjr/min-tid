// Server configuration from the environment — pure, so it can be tested without Express.
//
// The two things that went wrong on the first Railway test deploy:
//  1. data.json lived on the container's temporary disk, so every redeploy wiped every
//     account (phones kept a valid token for a user that no longer existed → 404).
//  2. JWT_SECRET was not set, so tokens were signed with the public default in this file.
// Both are now detected at startup: (2) refuses to start in production, (1) is logged
// loudly and reported by GET /api/health so the app's debug panel can show it.

import path from "node:path";

export const DEV_JWT_SECRET = "dev-secret-change-in-production";
/** Placeholders that have appeared in this repo's docs/compose file — never valid. */
const PLACEHOLDER_SECRETS = new Set([
  DEV_JWT_SECRET,
  "change-this-to-a-long-random-string-in-production",
  "<long random string>",
]);
const MIN_SECRET_LENGTH = 32;

function isInside(file, dir) {
  const d = dir.replace(/\/+$/, "");
  return file === d || file.startsWith(d + "/");
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} serverDir directory of server/index.js (dev default for data.json)
 */
export function resolveServerConfig(env, serverDir) {
  const prod = env.NODE_ENV === "production";
  const onRailway = Boolean(
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_ENVIRONMENT_NAME ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_SERVICE_ID,
  );
  // Set by Railway at runtime when a volume is attached to the service.
  const volumePath = env.RAILWAY_VOLUME_MOUNT_PATH || null;

  const dataPath =
    env.DATA_PATH ||
    (volumePath
      ? path.posix.join(volumePath, "data.json")
      : prod
        ? "/app/data/data.json"
        : path.join(serverDir, "data.json"));

  /** "persistent" | "ephemeral" | "unknown" */
  let storage;
  if (onRailway)
    storage = volumePath && isInside(dataPath, volumePath) ? "persistent" : "ephemeral";
  else storage = env.DATA_PERSISTENT === "1" ? "persistent" : "unknown";

  const fatal = [];
  const warnings = [];

  const secret = env.JWT_SECRET;
  const secretOk =
    !!secret && !PLACEHOLDER_SECRETS.has(secret) && secret.length >= MIN_SECRET_LENGTH;
  if (prod && !secretOk) {
    fatal.push(
      `JWT_SECRET saknas eller är för svag. Sätt en slumpmässig sträng på minst ${MIN_SECRET_LENGTH} tecken ` +
        `(t.ex. "openssl rand -base64 48") som miljövariabel. Utan den kan vem som helst förfalska inloggningar.`,
    );
  }

  if (storage === "ephemeral") {
    warnings.push(
      volumePath
        ? `DATA_PATH (${dataPath}) ligger utanför volymen (${volumePath}). Alla konton försvinner vid nästa deploy.`
        : `Ingen volym monterad. ${dataPath} ligger på containerns tillfälliga disk – ALLA KONTON FÖRSVINNER VID NÄSTA DEPLOY. ` +
            `Lägg till en Volume på tjänsten i Railway med mount path /app/data.`,
    );
  }

  return {
    prod,
    port: parseInt(env.PORT ?? (prod ? "3000" : "3001"), 10),
    jwtSecret: secretOk ? secret : (secret ?? DEV_JWT_SECRET),
    dataPath,
    storage,
    onRailway,
    volumePath,
    fatal,
    warnings,
  };
}

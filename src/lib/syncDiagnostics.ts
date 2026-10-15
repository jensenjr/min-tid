// Sync failure diagnostics — the plain-Swedish explanation behind the red banner,
// plus the small rolling log that goes into a felanmälan.
//
// The motivating case: a corporate/guest WiFi lets the app load (it is just static
// files) but a proxy answers 403 on /api. The app keeps working offline, so without
// a visible signal the user has no idea their hours never left the phone.

export const SYNC_ERROR_LOG_KEY = "sync_error_log";
const MAX_LOG = 10;

/** Where to send a felanmälan. */
export const SUPPORT_EMAIL = "christian@krut.it";

export type SyncFailure = {
  at: number; // ms
  status: number; // HTTP status, or 0 when the request never got a response
  path: string; // "/api/sync"
  method: string; // "GET" | "PUT" | …
  message: string; // server error text, or the fetch failure
  online: boolean; // navigator.onLine at the time
};

export type SyncErrorExplanation = {
  /** Short headline for the banner. */
  headline: string;
  /** What is most likely going on, in one sentence. */
  cause: string;
  /** Ordered suggestions, most likely to help first. */
  fixes: string[];
  /** True when switching network is the primary suggestion. */
  networkBlocked: boolean;
  /**
   * True when the fix is to log in to sync again on this device (expired session, no
   * encryption key on the device, secret changed elsewhere, cloud copy won't decrypt).
   * The settings sheet then offers "Logga in igen", which keeps and merges local data.
   */
  relogin: boolean;
  /**
   * True when the account no longer exists on the server (404): the fix is to set sync up
   * again from this device ("Aktivera synk igen"), which uploads the local data.
   */
  recreate?: boolean;
};

export function explainSyncError(f: SyncFailure | null): SyncErrorExplanation {
  if (f && !f.online) {
    return {
      headline: "Ingen internetanslutning",
      cause: "Enheten är offline, så inget kan skickas till molnet.",
      fixes: [
        "Anslut till WiFi eller slå på mobildata.",
        "Dina stämplingar sparas lokalt och laddas upp automatiskt när nätet är tillbaka.",
      ],
      networkBlocked: false,
      relogin: false,
    };
  }

  const status = f?.status ?? 0;

  // 0 = the request never completed (blocked, DNS, TLS, captive portal).
  // 403 = something answered, but refused — on a work network that is nästan
  // alltid en proxy/brandvägg framför appens server, inte appen själv.
  if (status === 0 || status === 403 || status === 407 || status === 451) {
    return {
      headline: "Nätverket blockerar synken",
      cause:
        "Appen laddar, men anslutningen till synk-servern stoppas innan den kommer fram — typiskt en brandvägg, proxy eller filtrering på jobb- och gästnätverk.",
      fixes: [
        "Byt nät: slå av WiFi och kör på mobildata, eller använd en hotspot.",
        "Är du på VPN? Stäng av det och försök igen.",
        "Tryck ”Försök igen” när du bytt nät — allt du stämplat under tiden laddas upp då.",
        "Fortsätter det på alla nät: skicka felloggen så kan vi kolla servern.",
      ],
      networkBlocked: true,
      relogin: false,
    };
  }

  // 401: the session expired (30 days) — or, since sync became end-to-end encrypted,
  // this device has a session but no encryption key (it last synced with an older build).
  if (status === 401) {
    return {
      headline: "Logga in igen för att synka",
      cause:
        "Den här enheten behöver logga in på synken igen — antingen har inloggningen gått ut (den gäller i 30 dagar), eller så saknar enheten nyckeln sedan synken blev krypterad.",
      fixes: [
        "Tryck ”Logga in igen” och ange ditt användarnamn och din synk-kod.",
        "Dina lokala data ligger kvar — de slås ihop med molnet när du loggat in.",
      ],
      networkBlocked: false,
      relogin: true,
    };
  }

  // 409: the secret (and with it the encryption key) was changed on another device.
  // Pre-encryption clients also get 409s from the server, but never run this code.
  if (status === 409) {
    return {
      headline: "Synk-koden har bytts",
      cause:
        "Synk-koden har bytts på en annan enhet. Datan i molnet är krypterad med den nya koden, så den här enheten kan varken läsa eller skriva den.",
      fixes: [
        "Tryck ”Logga in igen” och ange den nya synk-koden.",
        "Dina lokala data ligger kvar — de slås ihop med molnet när du loggat in.",
      ],
      networkBlocked: false,
      relogin: true,
    };
  }

  // 422: the envelope does not decrypt with this device's key (damaged or foreign).
  if (status === 422) {
    return {
      headline: "Molnkopian kunde inte låsas upp",
      cause:
        "Den krypterade datan i molnet gick inte att dekryptera med nyckeln på den här enheten. Den kan ha skadats, eller krypterats med en annan nyckel.",
      fixes: [
        "Tryck ”Logga in igen” och ange din synk-kod.",
        "Kvarstår det: skicka felloggen. Dina lokala data ligger kvar.",
      ],
      networkBlocked: false,
      relogin: true,
    };
  }

  // 404 on an authenticated call: the session is valid but the account is gone — the
  // server's data file was reset (e.g. redeployed without a persistent volume) or the
  // account was removed after 60 days without activity.
  if (status === 404) {
    return {
      headline: "Ditt synk-konto finns inte på servern",
      cause:
        "Servern känner inte igen kontot längre. Det händer om servern har nollställts eller om kontot tagits bort efter lång tids inaktivitet. Dina tider på den här enheten finns kvar.",
      fixes: [
        "Tryck ”Aktivera synk igen” och skapa kontot på nytt – gärna med samma användarnamn.",
        "Allt som finns på den här enheten laddas upp till det nya kontot.",
        "Har du fler enheter: logga in på dem med det nya kontot efteråt.",
      ],
      networkBlocked: false,
      relogin: false,
      recreate: true,
    };
  }

  if (status === 405) {
    return {
      headline: "Servern svarar fel",
      cause:
        "Appen når en filserver i stället för API:t — det brukar betyda att en ny version håller på att driftsättas.",
      fixes: [
        "Vänta någon minut och tryck ”Försök igen”.",
        "Kvarstår det: skicka felloggen, det är ett serverfel och inget du kan lösa i appen.",
      ],
      networkBlocked: false,
      relogin: false,
    };
  }

  if (status >= 500) {
    return {
      headline: "Synk-servern svarar inte som den ska",
      cause: "Servern svarade med ett fel. Det är inget fel på din enhet eller din data.",
      fixes: [
        "Tryck ”Försök igen” om en stund.",
        "Kvarstår det: skicka felloggen så kan vi titta på servern.",
      ],
      networkBlocked: false,
      relogin: false,
    };
  }

  return {
    headline: "Synken fungerar inte",
    cause: f?.message
      ? `Servern svarade: ${f.message}`
      : "Något gick fel när appen skulle prata med molnet.",
    fixes: [
      "Tryck ”Försök igen”.",
      "Testa ett annat nät (mobildata) — det löser de flesta fallen.",
      "Kvarstår det: skicka felloggen.",
    ],
    networkBlocked: false,
    relogin: false,
  };
}

// ─── Rolling log ──────────────────────────────────────────────
// Device-local and never synced (it is diagnostics about sync failing).

export function readSyncErrorLog(): SyncFailure[] {
  try {
    const raw = localStorage.getItem(SYNC_ERROR_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SyncFailure[]) : [];
  } catch {
    return [];
  }
}

export function logSyncFailure(f: SyncFailure): SyncFailure[] {
  const next = [f, ...readSyncErrorLog()].slice(0, MAX_LOG);
  try {
    localStorage.setItem(SYNC_ERROR_LOG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearSyncErrorLog() {
  try {
    localStorage.removeItem(SYNC_ERROR_LOG_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Felanmälan ───────────────────────────────────────────────
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const stamp = (ms: number) =>
  new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

/** What the debug panel knows about this device's sync session (no token, no key bytes). */
export type SyncDebugContext = {
  server?: string;
  serverVersion?: string | null;
  /** From GET /api/health; null = no answer. */
  serverStorage?: "persistent" | "ephemeral" | "unknown" | null;
  syncStatus?: string;
  syncRev?: number | null;
  tokenPresent?: boolean;
  tokenExpiresAt?: number | null;
  keyPresent?: boolean;
  keyMatchesToken?: boolean;
  keyId?: string | null;
};

export type SyncReportInput = {
  failure: SyncFailure | null;
  log: SyncFailure[];
  username?: string | null;
  version: string;
  lastSyncedAt?: number | null;
  pendingChanges: boolean;
  debug?: SyncDebugContext;
};

export function storageText(s: SyncDebugContext["serverStorage"]): string {
  if (s === "persistent") return "beständig";
  if (s === "ephemeral") return "TILLFÄLLIG – alla konton försvinner vid nästa deploy";
  if (s === "unknown") return "okänd (ingen Railway-volym att kontrollera)";
  return "inget svar från /api/health";
}

const yesNo = (v: boolean | undefined) => (v === undefined ? "-" : v ? "ja" : "nej");
const statusText = (s: number) => (s === 0 ? "ingen kontakt med servern" : "HTTP " + s);

/**
 * The felanmälan / felsökningsinfo as plain text — what "Kopiera" puts on the clipboard
 * and what the mail body carries. Never includes the sync token or the secret.
 */
export function buildSyncReportText(opts: SyncReportInput): string {
  const { failure, log, username, version, lastSyncedAt, pendingChanges, debug } = opts;
  const at = failure?.at ?? Date.now();

  const lines: (string | null)[] = [
    "felanmälan app. får ingen sync.",
    "",
    "--- fellogg ---",
    `App:            min-tid v${version}`,
    `Tid:            ${stamp(at)}`,
    `Användare:      ${username ? "@" + username : "(ej inloggad på synk)"}`,
    failure
      ? `Fel:            ${statusText(failure.status)} (${failure.method} ${failure.path})`
      : "Fel:            (inget registrerat)",
    failure ? `Meddelande:     ${failure.message}` : null,
    failure ? `Förklaring:     ${explainSyncError(failure).headline}` : null,
    `Nätverk:        ${failure ? (failure.online ? "online" : "offline") : "-"}`,
    `Senast synkat:  ${lastSyncedAt ? stamp(lastSyncedAt) : "aldrig"}`,
    `Osparade ändr.: ${pendingChanges ? "ja" : "nej"}`,
  ];
  if (debug) {
    lines.push(
      `Server:         ${debug.server ?? "-"}${debug.serverVersion ? " (v" + debug.serverVersion + ")" : ""}`,
      `Serverlagring:  ${storageText(debug.serverStorage)}`,
      `Synkstatus:     ${debug.syncStatus ?? "-"}`,
      `Server-rev:     ${debug.syncRev ? stamp(debug.syncRev) + " (" + debug.syncRev + ")" : "ingen"}`,
      `Inloggning:     ${debug.tokenPresent ? "finns" + (debug.tokenExpiresAt ? ", giltig till " + stamp(debug.tokenExpiresAt) : "") : "saknas"}`,
      `Nyckel på enh.: ${yesNo(debug.keyPresent)}${debug.keyPresent ? " (id " + (debug.keyId ?? "?") + (debug.keyMatchesToken === false ? ", TILLHÖR ANNAT KONTO" : "") + ")" : ""}`,
    );
  }
  lines.push(`Enhet:          ${typeof navigator !== "undefined" ? navigator.userAgent : "-"}`);

  if (log.length > 1) {
    lines.push("", "Tidigare fel:");
    for (const e of log.slice(1)) {
      lines.push(
        `  ${hhmm(e.at)}  ${e.status === 0 ? "ingen kontakt" : "HTTP " + e.status}  ${e.method} ${e.path}  ${e.message}`,
      );
    }
  }
  return (lines.filter((l) => l !== null) as string[]).join("\n");
}

/** mailto: for the felanmälan. Same text as buildSyncReportText. */
export function buildSyncReportMailto(opts: SyncReportInput): string {
  const at = opts.failure?.at ?? Date.now();
  const subject = `mintid sync error kl ${hhmm(at)}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildSyncReportText(opts))}`;
}

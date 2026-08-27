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
  at: number;       // ms
  status: number;   // HTTP status, or 0 when the request never got a response
  path: string;     // "/api/sync"
  method: string;   // "GET" | "PUT" | …
  message: string;  // server error text, or the fetch failure
  online: boolean;  // navigator.onLine at the time
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
    };
  }

  if (status === 401) {
    return {
      headline: "Synk-sessionen har gått ut",
      cause: "Servern känner inte längre igen den här enheten. Inloggningen är 30 dagar.",
      fixes: [
        "Öppna synk-inställningarna och logga in igen med ditt användarnamn och din synk-kod.",
        "Dina lokala data ligger kvar — inget försvinner av att logga in på nytt.",
      ],
      networkBlocked: false,
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
  try { localStorage.setItem(SYNC_ERROR_LOG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function clearSyncErrorLog() {
  try { localStorage.removeItem(SYNC_ERROR_LOG_KEY); } catch { /* ignore */ }
}

// ─── Felanmälan ───────────────────────────────────────────────
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const stamp = (ms: number) =>
  new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

/**
 * Build the mailto: for a felanmälan. Includes what we know about the failure and
 * nothing else — never the sync token or the secret.
 */
export function buildSyncReportMailto(opts: {
  failure: SyncFailure | null;
  log: SyncFailure[];
  username?: string | null;
  version: string;
  lastSyncedAt?: number | null;
  pendingChanges: boolean;
}): string {
  const { failure, log, username, version, lastSyncedAt, pendingChanges } = opts;
  const at = failure?.at ?? Date.now();

  const lines = [
    "felanmälan app. får ingen sync.",
    "",
    "--- fellogg ---",
    `App:            min-tid v${version}`,
    `Tid:            ${stamp(at)}`,
    `Användare:      ${username ? "@" + username : "(ej inloggad på synk)"}`,
    failure
      ? `Fel:            ${failure.status === 0 ? "ingen kontakt med servern" : "HTTP " + failure.status} (${failure.method} ${failure.path})`
      : "Fel:            (inget registrerat)",
    failure ? `Meddelande:     ${failure.message}` : null,
    `Nätverk:        ${failure ? (failure.online ? "online" : "offline") : "-"}`,
    `Senast synkat:  ${lastSyncedAt ? stamp(lastSyncedAt) : "aldrig"}`,
    `Osparade ändr.: ${pendingChanges ? "ja" : "nej"}`,
    `Enhet:          ${typeof navigator !== "undefined" ? navigator.userAgent : "-"}`,
  ].filter(Boolean) as string[];

  if (log.length > 1) {
    lines.push("", "Tidigare fel:");
    for (const e of log.slice(1)) {
      lines.push(`  ${hhmm(e.at)}  ${e.status === 0 ? "ingen kontakt" : "HTTP " + e.status}  ${e.method} ${e.path}`);
    }
  }

  const subject = `mintid sync error kl ${hhmm(at)}`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

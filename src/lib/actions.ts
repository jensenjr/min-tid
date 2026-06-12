// URL actions — the backbone of "effortless" check-in/out.
//
// The app accepts  /?action=in|out|toggle&source=qr|nfc|wifi|shortcut|link
// which means any trigger that can open a URL can punch the clock:
//   • a printed QR code at the office door (iPhone camera → opens URL)
//   • an NFC tag (iOS Shortcuts automation "When NFC tag is scanned → Open URL")
//   • WiFi join/leave (iOS Shortcuts automation "When connecting to <office WiFi>")
//   • the home-screen app shortcuts declared in manifest.webmanifest
//
// PunchClock parses the action once on mount, strips it from the address bar,
// and executes it schedule-aware (confirmation on off-schedule days, dedupe
// against WiFi flapping / double scans).

export type PunchAction = "in" | "out" | "toggle";
export type ActionSource = "qr" | "nfc" | "wifi" | "shortcut" | "link";

export type ParsedAction = { action: PunchAction; source: ActionSource };

export const SOURCE_META: Record<ActionSource, { label: string; emoji: string }> = {
  qr: { label: "QR-kod", emoji: "📷" },
  nfc: { label: "NFC-tagg", emoji: "🏷️" },
  wifi: { label: "WiFi", emoji: "📶" },
  shortcut: { label: "Genväg", emoji: "⚡" },
  link: { label: "Länk", emoji: "🔗" },
};

const ACTIONS: PunchAction[] = ["in", "out", "toggle"];
const SOURCES: ActionSource[] = ["qr", "nfc", "wifi", "shortcut", "link"];

/** Read ?action=…&source=… from the address bar and strip it (so a reload
 *  doesn't re-punch). Returns null when no valid action is present. */
export function consumeActionFromUrl(): ParsedAction | null {
  const params = new URLSearchParams(window.location.search);
  const rawAction = params.get("action");
  if (!rawAction) return null;

  params.delete("action");
  const rawSource = params.get("source");
  params.delete("source");
  const rest = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);

  if (!ACTIONS.includes(rawAction as PunchAction)) return null;
  const source = SOURCES.includes(rawSource as ActionSource) ? (rawSource as ActionSource) : "link";
  return { action: rawAction as PunchAction, source };
}

/** Absolute URL that triggers an action — what goes in QR codes, NFC tags
 *  and Shortcuts automations. */
export function actionUrl(action: PunchAction, source: ActionSource): string {
  return `${window.location.origin}/?action=${action}&source=${source}`;
}

// ── Dedupe ───────────────────────────────────────────────────
// WiFi automations flap (brief disconnects), QR codes get double-scanned.
// Remember the last executed auto-action and swallow repeats inside the window.
const DEDUPE_KEY = "punchclock_last_auto_action";
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

export function isDuplicateAction(action: PunchAction): boolean {
  try {
    const raw = localStorage.getItem(DEDUPE_KEY);
    if (!raw) return false;
    const last = JSON.parse(raw) as { action: PunchAction; ts: number };
    return last.action === action && Date.now() - last.ts < DEDUPE_WINDOW_MS;
  } catch {
    return false;
  }
}

export function rememberAction(action: PunchAction) {
  try {
    localStorage.setItem(DEDUPE_KEY, JSON.stringify({ action, ts: Date.now() }));
  } catch {
    /* private mode etc. — dedupe is best-effort */
  }
}

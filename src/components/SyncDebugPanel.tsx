import { useEffect, useState } from "react";
import {
  syncDeviceInfo,
  syncServerHealth,
  type ServerHealth,
  type SyncDeviceInfo,
} from "../lib/sync";
import {
  SUPPORT_EMAIL,
  buildSyncReportMailto,
  buildSyncReportText,
  clearSyncErrorLog,
  explainSyncError,
  storageText,
  type SyncFailure,
} from "../lib/syncDiagnostics";

// Shown in the profile/sync sheet only when "Felsökningsläge" is on. Everything here is
// device-local diagnostics; the token and key material never appear.

const stamp = (ms: number) =>
  new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" });

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex gap-3 py-1 border-t border-[#e9e2da] first:border-t-0">
      <span className="w-[112px] shrink-0 text-[11px] font-bold text-[#8a7a6e]">{k}</span>
      <span
        className="flex-1 min-w-0 text-[11px] font-semibold break-words"
        style={{ color: warn ? "#b91c1c" : "#2d1717" }}
      >
        {v}
      </span>
    </div>
  );
}

export default function SyncDebugPanel({
  token,
  username,
  syncStatus,
  syncedAt,
  syncRev,
  dirty,
  failure,
  log,
  onPullNow,
}: {
  token: string | null;
  username: string | null;
  syncStatus: string;
  syncedAt: number | null;
  syncRev: number | null;
  dirty: boolean;
  failure: SyncFailure | null;
  log: SyncFailure[];
  onPullNow: () => void;
}) {
  const [info, setInfo] = useState<SyncDeviceInfo | null>(null);
  const [health, setHealth] = useState<ServerHealth | null | "loading">("loading");
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let alive = true;
    void syncDeviceInfo(token).then((i) => alive && setInfo(i));
    void syncServerHealth().then((h) => alive && setHealth(h));
    return () => {
      alive = false;
    };
  }, [token, syncStatus]);

  const visibleLog = cleared ? [] : log;
  const reportInput = {
    failure,
    log: visibleLog,
    username,
    version: __APP_VERSION__,
    lastSyncedAt: syncedAt,
    pendingChanges: dirty,
    debug: info
      ? {
          server: info.server,
          serverVersion: health && health !== "loading" ? (health.version ?? null) : null,
          serverStorage: health && health !== "loading" ? (health.storage ?? null) : null,
          syncStatus,
          syncRev,
          tokenPresent: info.tokenPresent,
          tokenExpiresAt: info.tokenExpiresAt,
          keyPresent: info.keyPresent,
          keyMatchesToken: info.keyMatchesToken,
          keyId: info.keyId,
        }
      : { syncStatus, syncRev },
  };
  const reportText = buildSyncReportText(reportInput);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied("ok");
    } catch {
      // No clipboard access (http, old browser): show the text so it can be copied by hand.
      setCopied("manual");
    }
  }

  const expired = !!info?.tokenExpiresAt && info.tokenExpiresAt < Date.now();

  return (
    <div
      id="sync-debug"
      className="rounded-[16px] mb-3 px-4 py-3"
      style={{ background: "#f6f3ef", border: "1.5px dashed #cbbfb3" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#5b4a3f]">
          🛠 Felsökning
        </div>
        <button
          type="button"
          onClick={onPullNow}
          className="text-[11px] font-bold text-[#ff5f00] underline"
        >
          Testa anslutning nu
        </button>
      </div>

      <div className="mb-3">
        <Row
          k="Server"
          v={`${info?.server ?? "…"}${health && health !== "loading" && health.version ? ` (v${health.version})` : ""}`}
        />
        <Row
          k="Serverns lagring"
          v={health === "loading" ? "…" : storageText(health ? (health.storage ?? null) : null)}
          warn={health !== "loading" && (!health || health.storage === "ephemeral")}
        />
        <Row k="Synkstatus" v={syncStatus} warn={syncStatus === "error"} />
        <Row k="Användare" v={username ? `@${username}` : "(ej inloggad)"} />
        <Row
          k="Inloggning"
          v={
            !info
              ? "…"
              : !info.tokenPresent
                ? "saknas"
                : info.tokenExpiresAt
                  ? `${expired ? "UTGÅNGEN" : "giltig"} till ${stamp(info.tokenExpiresAt)}`
                  : "finns"
          }
          warn={!!info && (!info.tokenPresent || expired)}
        />
        <Row
          k="Nyckel på enheten"
          v={
            !info
              ? "…"
              : !info.keyPresent
                ? "saknas – logga in igen"
                : `ja (id ${info.keyId})${info.keyMatchesToken ? "" : " – tillhör ett annat konto"}`
          }
          warn={!!info && (!info.keyPresent || !info.keyMatchesToken)}
        />
        <Row k="Senast synkat" v={syncedAt ? stamp(syncedAt) : "aldrig"} />
        <Row k="Server-revision" v={syncRev ? `${stamp(syncRev)} (${syncRev})` : "ingen ännu"} />
        <Row k="Osparade ändringar" v={dirty ? "ja – väntar på uppladdning" : "nej"} />
        {failure && (
          <>
            <Row
              k="Senaste fel"
              v={`${failure.status === 0 ? "ingen kontakt" : "HTTP " + failure.status} · ${failure.method} ${failure.path}`}
              warn
            />
            <Row k="Serverns svar" v={failure.message || "–"} warn />
            <Row k="Tolkning" v={explainSyncError(failure).headline} />
            <Row k="Tidpunkt" v={stamp(failure.at)} />
          </>
        )}
      </div>

      {visibleLog.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8a7a6e] mb-1">
            Fellogg ({visibleLog.length})
          </div>
          <div className="rounded-[10px] bg-white border border-[#e9e2da] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[#2d1717] max-h-[140px] overflow-y-auto">
            {visibleLog.map((e, i) => (
              <div key={i} className="break-words">
                {new Date(e.at).toLocaleTimeString("sv-SE")}{" "}
                {e.status === 0 ? "ingen kontakt" : e.status} {e.method} {e.path} – {e.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8a7a6e] mb-1.5">
        Skicka felrapport
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copy}
          className="pc-press py-2.5 rounded-[12px] bg-white border border-[#cbbfb3] text-[12px] font-bold text-[#2d1717]"
        >
          {copied === "ok" ? "✓ Kopierat" : "1. Kopiera"}
        </button>
        <a
          href={buildSyncReportMailto(reportInput)}
          className="pc-press py-2.5 rounded-[12px] bg-[#2d1717] text-center text-[12px] font-bold text-white no-underline"
        >
          2. Öppna e-post
        </a>
      </div>
      <div className="text-[10px] text-[#8a7a6e] mt-1.5 leading-snug">
        Öppnas ingen e-post: klistra in det kopierade i ett mejl till {SUPPORT_EMAIL}. Rapporten
        innehåller aldrig din synk-kod eller inloggning.
      </div>
      {copied === "manual" && (
        <textarea
          readOnly
          value={reportText}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          className="w-full mt-2 h-[160px] rounded-[10px] border border-[#cbbfb3] p-2 font-mono text-[10px]"
        />
      )}
      {visibleLog.length > 0 && (
        <button
          type="button"
          onClick={() => {
            clearSyncErrorLog();
            setCleared(true);
          }}
          className="mt-2 text-[11px] font-bold text-[#8a7a6e] underline"
        >
          Rensa felloggen
        </button>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  acknowledgeRecoveryKey,
  getPendingRecoveryKey,
  onPendingRecoveryKeyChange,
  type PendingRecoveryKey,
  type RecoveryKeyReason,
} from "../lib/sync";
import { formatRecoveryKey } from "../lib/crypto";

// Shows a freshly minted recovery key exactly once and won't let go until the user
// ticks "saved". Self-contained: it listens to sync.ts for a pending key (stored in
// IndexedDB, so it survives a reload until acknowledged), which means it can be mounted
// with one line wherever a flow can mint a key — SyncModal mounts it permanently, and
// onboarding mounts it on the step that follows "Skapa konto".

const REASON: Record<RecoveryKeyReason, string> = {
  created: "Ditt synk-konto är skapat och allt krypteras nu på enheten innan det skickas.",
  migrated: "Synken är nu krypterad på enheten. Servern lagrar bara krypterad data.",
  rotated:
    "Du har bytt synk-kod, så du får en ny återställningsnyckel. Den gamla slutar gälla — släng den.",
  recovered:
    "Kontot är återställt med en ny synk-kod, och du får en ny återställningsnyckel. Den gamla slutar gälla.",
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function printKey(p: PendingRecoveryKey) {
  const date = new Date().toLocaleDateString("sv-SE", { dateStyle: "long" });
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>min-tid – återställningsnyckel</title>
<style>body{font-family:system-ui,sans-serif;color:#2d1717;padding:32px;max-width:560px}
h1{font-size:20px;margin:0 0 4px}.meta{color:#6b5a4a;font-size:13px;margin-bottom:24px}
.key{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:2px;
border:2px solid #2d1717;border-radius:12px;padding:18px;text-align:center;margin-bottom:24px}
p{font-size:13px;line-height:1.5;margin:0 0 10px}</style></head><body>
<h1>min-tid – återställningsnyckel</h1>
<div class="meta">Konto: @${escapeHtml(p.username)} · Utskriven ${escapeHtml(date)}</div>
<div class="key">${escapeHtml(formatRecoveryKey(p.key))}</div>
<p><b>Behövs om du glömmer din synk-kod.</b> Då kan du få tillbaka kontot via SMS, men dina data låses bara upp igen med den här nyckeln. Utan den går molnkopian inte att läsa — inte ens för oss.</p>
<p>Förvara papperet säkert. Den som har nyckeln och kommer åt ditt konto kan läsa dina tider.</p>
<p>Byter du synk-kod får du en ny nyckel, och den här slutar gälla.</p>
</body></html>`;
  // A hidden iframe instead of window.open: no popup blocker, works in an installed PWA.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  const cleanup = () => iframe.remove();
  iframe.onload = () => {
    const w = iframe.contentWindow;
    if (!w) return cleanup();
    w.onafterprint = cleanup;
    w.focus();
    w.print();
    setTimeout(cleanup, 60_000);
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

export default function RecoveryKeySheet() {
  const [pending, setPending] = useState<PendingRecoveryKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      getPendingRecoveryKey()
        .then((p) => alive && setPending(p))
        .catch(() => undefined);
    };
    refresh();
    const off = onPendingRecoveryKeyChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // A different key (e.g. right after a secret change) must be confirmed afresh.
  useEffect(() => {
    setSaved(false);
    setCopied(false);
    setClosing(false);
  }, [pending?.key]);

  if (!pending) return null;
  const pretty = formatRecoveryKey(pending.key);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
    } catch {
      // No clipboard permission: select the key so the user can copy it by hand.
      const el = document.getElementById("recovery-key-value");
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  async function done() {
    if (!saved || closing) return;
    setClosing(true);
    try {
      await acknowledgeRecoveryKey();
    } finally {
      setClosing(false);
    }
  }

  const secondaryBtn: React.CSSProperties = {
    flex: 1,
    padding: "12px",
    borderRadius: "14px",
    background: "#fdf6ee",
    border: "1.5px solid #ece6df",
    fontWeight: 700,
    fontSize: "14px",
    color: "#2d1717",
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.6)", animation: "pcOverlay 0.25s ease" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-key-title"
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "92dvh",
        }}
      >
        <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />
        <div id="recovery-key-title" className="font-extrabold text-[22px] tracking-tight mb-1">
          🔐 Spara din återställningsnyckel
        </div>
        <p className="text-[13px] text-[#9c7c5c] mb-4 leading-relaxed">{REASON[pending.reason]}</p>

        <div
          className="rounded-[16px] px-4 py-4 mb-3 text-center"
          style={{ background: "#fdf6ee", border: "2px dashed #e6d5c3" }}
        >
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
            Återställningsnyckel för @{pending.username}
          </div>
          <div
            id="recovery-key-value"
            className="grid grid-cols-3 gap-x-3 gap-y-1 justify-center select-all"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "20px",
              fontWeight: 800,
              letterSpacing: "0.08em",
              color: "#2d1717",
            }}
          >
            {pretty.split("-").map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
          Skriv ut / kopiera
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={copy} style={secondaryBtn}>
            {copied ? "✅ Kopierad" : "📋 Kopiera"}
          </button>
          <button onClick={() => printKey(pending)} style={secondaryBtn}>
            🖨️ Skriv ut
          </button>
        </div>

        <div
          className="rounded-[14px] px-4 py-3 mb-4 text-[12px] leading-relaxed"
          style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#7c2d12" }}
        >
          <div className="font-bold mb-1">Varför den behövs</div>
          Glömmer du synk-koden kan du få tillbaka <b>kontot</b> via SMS — men dina <b>data</b> kan
          bara låsas upp igen med den här nyckeln. Utan den går molnkopian inte att läsa, inte ens
          för oss. Nyckeln visas bara den här gången: spara den i en lösenordshanterare eller skriv
          ut den och förvara den säkert.
        </div>

        <label className="flex items-start gap-3 mb-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0"
            style={{ accentColor: "#ff5f00" }}
          />
          <span className="text-[13px] font-semibold text-[#2d1717] leading-snug">
            Jag har sparat återställningsnyckeln på ett säkert ställe.
          </span>
        </label>

        <button
          onClick={done}
          disabled={!saved || closing}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "14px",
            background: saved ? "#ff5f00" : "#f0e8df",
            color: saved ? "white" : "#c4a882",
            fontWeight: 700,
            fontSize: "15px",
            boxShadow: saved ? "0 8px 20px -8px rgba(255,95,0,0.6)" : "none",
          }}
        >
          Klar
        </button>
      </div>
    </div>
  );
}

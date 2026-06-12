import { useState, useEffect } from "react";
import { renderSVG } from "uqr";
import { actionUrl, type PunchAction } from "../lib/actions";

// "Automatisering" — everything needed to punch the clock without opening
// the app: printable QR codes, iOS Shortcuts recipes for WiFi and NFC, and
// home-screen install instructions. All triggers are plain URLs (see
// src/lib/actions.ts), so no native app is required.

const QR_TABS: { action: PunchAction; label: string }[] = [
  { action: "in", label: "Checka in" },
  { action: "out", label: "Checka ut" },
  { action: "toggle", label: "Växla" },
];

export default function AutomationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [qrAction, setQrAction] = useState<PunchAction>("in");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQrAction("in");
      setCopied(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 2000);
    } catch { /* ignore */ }
  }

  function printSigns() {
    const w = window.open("", "_blank");
    if (!w) return;
    const sign = (label: string, action: PunchAction) => `
      <div style="page-break-inside:avoid;text-align:center;padding:40px 0;">
        <div style="font:800 34px/1.2 -apple-system,sans-serif;color:#2d1717;margin-bottom:6px;">${label}</div>
        <div style="font:600 15px/1.4 -apple-system,sans-serif;color:#9c7c5c;margin-bottom:20px;">Skanna med mobilkameran</div>
        <div style="width:260px;margin:0 auto;">${renderSVG(actionUrl(action, "qr"), { border: 2 })}</div>
      </div>`;
    w.document.write(`<!DOCTYPE html><html><head><title>min tid – QR-skyltar</title></head><body>
      ${sign("✅ Checka in", "in")}
      ${sign("🏁 Checka ut", "out")}
    </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  const qrUrl = actionUrl(qrAction, "qr");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "92dvh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Automatisering</div>
        <div className="text-[13px] text-pc-muted mb-6">
          Stämpla utan att öppna appen — via QR-kod, NFC-tagg eller automatiskt när du
          ansluter till kontorets WiFi. Allt bygger på vanliga länkar, så det fungerar
          direkt med iPhones inbyggda Genvägar-app.
        </div>

        {/* ── QR codes ── */}
        <Section title="QR-koder" emoji="📷">
          <p className="text-[13px] text-pc-muted mb-3">
            Skriv ut och sätt vid entrén. Skanna med mobilkameran så stämplas du in eller ut.
          </p>
          <div className="flex bg-[#fdf6ee] border border-pc-line rounded-full p-0.5 mb-4">
            {QR_TABS.map(t => (
              <button
                key={t.action}
                onClick={() => setQrAction(t.action)}
                className={`flex-1 px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors ${
                  qrAction === t.action ? "bg-pc-orange text-white" : "text-pc-muted"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            className="w-[190px] mx-auto mb-3 rounded-[16px] border border-pc-line p-3 bg-white"
            dangerouslySetInnerHTML={{ __html: renderSVG(qrUrl, { border: 1 }) }}
          />
          <div className="grid grid-cols-2 gap-3">
            <SecondaryBtn onClick={() => copy("qr", qrUrl)}>
              {copied === "qr" ? "✓ Kopierad" : "Kopiera länk"}
            </SecondaryBtn>
            <SecondaryBtn onClick={printSigns}>Skriv ut skyltar</SecondaryBtn>
          </div>
        </Section>

        {/* ── WiFi automation ── */}
        <Section title="Automatiskt via WiFi" emoji="📶">
          <p className="text-[13px] text-pc-muted mb-3">
            iPhone kan stämpla in dig automatiskt när du kommer till jobbet, via en
            personlig automation i appen <b>Genvägar</b>:
          </p>
          <Steps
            steps={[
              "Öppna Genvägar → Automation → +",
              "Välj utlösare \"WiFi\" och ditt kontorsnätverk",
              "Välj \"När ansluten\" och stäng av \"Fråga innan körning\"",
              "Lägg till åtgärden \"Öppna URL\" och klistra in länken nedan",
            ]}
          />
          <CopyRow label="Checka in (vid anslutning)" value={actionUrl("in", "wifi")} copied={copied} onCopy={copy} k="wifi-in" />
          <CopyRow label="Checka ut (vid frånkoppling)" value={actionUrl("out", "wifi")} copied={copied} onCopy={copy} k="wifi-out" />
          <p className="text-[11px] text-pc-muted mt-2">
            Appen ignorerar dubbletter inom 2 minuter och frågar först om schemat säger
            att du är ledig — korta WiFi-tapp stämplar dig alltså inte ut av misstag.
          </p>
        </Section>

        {/* ── NFC ── */}
        <Section title="NFC-tagg" emoji="🏷️">
          <p className="text-[13px] text-pc-muted mb-3">
            Klistra en billig NFC-tagg på skrivbordet och tryck mobilen mot den för att
            stämpla. Skapas också i <b>Genvägar</b>:
          </p>
          <Steps
            steps={[
              "Genvägar → Automation → + → \"NFC\"",
              "Skanna taggen och ge den ett namn",
              "Stäng av \"Fråga innan körning\"",
              "Lägg till \"Öppna URL\" med länken nedan",
            ]}
          />
          <CopyRow label="Växla in/ut (en tagg räcker)" value={actionUrl("toggle", "nfc")} copied={copied} onCopy={copy} k="nfc" />
        </Section>

        {/* ── Install as app ── */}
        <Section title="Installera som app" emoji="📱">
          <p className="text-[13px] text-pc-muted mb-1">
            Lägg appen på hemskärmen så öppnas den i helskärm som en riktig app, med
            egna snabbåtgärder för in-/utcheckning:
          </p>
          <Steps
            steps={[
              "Öppna appen i Safari",
              "Tryck på dela-knappen (fyrkanten med pil)",
              "Välj \"Lägg till på hemskärmen\"",
            ]}
          />
        </Section>

        <button
          onClick={onClose}
          className="w-full mt-2"
          style={{ padding: "15px", borderRadius: "16px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "15px", color: "#2d1717" }}
        >
          Stäng
        </button>
      </div>
    </div>
  );
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#fdf6ee] border border-[#ece6df] rounded-[20px] p-4 mb-3">
      <div className="text-[13px] font-extrabold text-pc-ink mb-2">
        <span className="mr-1.5">{emoji}</span>{title}
      </div>
      {children}
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="mb-3 space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2 text-[13px] font-medium text-pc-ink">
          <span className="shrink-0 w-5 h-5 rounded-full bg-pc-orange/15 text-pc-orange-deep text-[11px] font-extrabold flex items-center justify-center">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function CopyRow({ label, value, copied, onCopy, k }: {
  label: string; value: string; copied: string | null;
  onCopy: (key: string, text: string) => void; k: string;
}) {
  return (
    <button
      onClick={() => onCopy(k, value)}
      className="w-full text-left bg-white border border-pc-line rounded-[14px] px-3.5 py-2.5 mb-2 flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold text-pc-ink">{label}</div>
        <div className="text-[11px] text-pc-muted truncate">{value}</div>
      </div>
      <span className={`shrink-0 text-[11px] font-extrabold ${copied === k ? "text-green-600" : "text-pc-orange"}`}>
        {copied === k ? "✓ Kopierad" : "Kopiera"}
      </span>
    </button>
  );
}

function SecondaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="pc-press bg-white border border-pc-line rounded-[14px] py-2.5 font-bold text-[13px] text-pc-ink"
    >
      {children}
    </button>
  );
}

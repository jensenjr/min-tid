import { useState } from "react";
import { Sheet } from "./ui";

export type SyncStatus = "idle" | "syncing" | "pulling" | "ok" | "error";

/**
 * "Synk och säkerhet" in Mer. Keeps the green "Krypterad på enheten · AES-256" status
 * visible and routes to the existing pieces: SyncModal (activate / log in again),
 * SettingsModal (sync code, phone, disconnect, delete account) and — through SyncModal,
 * which keeps RecoveryKeySheet mounted — the one-time recovery key.
 */
export default function SyncSecuritySheet({
  open,
  onClose,
  syncToken,
  syncStatus,
  syncedAt,
  dirty,
  onPullNow,
  onSetupSync,
  onOpenAccount,
  demo = false,
}: {
  open: boolean;
  onClose: () => void;
  syncToken: string | null;
  syncStatus: SyncStatus;
  syncedAt: number | null;
  dirty: boolean;
  onPullNow: () => void;
  onSetupSync: () => void;
  onOpenAccount: () => void;
  /** Demo mode: sync is off, the sync keys are never read and the sheet says so. */
  demo?: boolean;
}) {
  const [explain, setExplain] = useState(false);
  if (!open) return null;

  let username: string | null = null;
  try {
    if (!demo) username = localStorage.getItem("sync_username");
  } catch {
    /* ignore */
  }
  const statusText =
    syncStatus === "pulling"
      ? "Hämtar från molnet…"
      : syncStatus === "syncing"
        ? "Synkroniserar…"
        : syncStatus === "error"
          ? "Synken fungerar inte"
          : syncedAt
            ? `Synkat ${new Date(syncedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`
            : "Synkronisering aktiv";

  return (
    <Sheet
      open
      onClose={onClose}
      title="Synk och säkerhet"
      subtitle="Dina tider ligger på den här enheten. Synk är valfri och krypterad."
    >
      <div
        className="rounded-[16px] mb-4 overflow-hidden"
        style={{ background: "#ecfdf5", border: "1.5px solid #a7f3d0" }}
      >
        <button
          onClick={() => setExplain((v) => !v)}
          className="w-full px-4 py-3 flex items-center gap-2 text-left"
          aria-expanded={explain}
        >
          <span className="text-[16px]">🔒</span>
          <span className="flex-1 text-[13px] font-extrabold" style={{ color: "#065f46" }}>
            Krypterad på enheten · AES-256
          </span>
          <span className="text-[11px] font-bold" style={{ color: "#047857" }}>
            {explain ? "↑" : "Vad ser servern?"}
          </span>
        </button>
        {explain && (
          <div className="px-4 pb-4 text-[12px] leading-relaxed" style={{ color: "#064e3b" }}>
            <p className="mb-2">
              <b>Servern ser inte</b> dina tider, frånvaro, utlägg, namn eller schema. Allt
              krypteras på enheten innan det skickas, med en nyckel som tas fram ur din synk-kod och
              aldrig lämnar enheten.
            </p>
            <p className="mb-2">
              <b>Servern ser</b> ditt användarnamn, när du senast synkade, hur stor den krypterade
              datan är — och ditt mobilnummer om du lagt till ett för SMS-återställning.
            </p>
            <p>
              Glömmer du synk-koden ger SMS dig tillbaka kontot, men datan låses bara upp med din
              återställningsnyckel.
            </p>
          </div>
        )}
      </div>

      {demo ? (
        <div className="bg-pc-apricot border border-pc-line rounded-[16px] px-4 py-3 mb-3 text-[13px] leading-snug">
          <div className="font-bold mb-0.5">Synk är avstängd i demoläget</div>
          <div className="text-pc-muted font-medium">
            Demon pratar aldrig med någon server och rör inte dina riktiga data. Avsluta demon för
            att slå på krypterad synk.
          </div>
        </div>
      ) : syncToken ? (
        <div className="bg-pc-apricot border border-pc-line rounded-[16px] px-4 py-3 mb-3">
          <div className="flex items-center gap-3">
            <span className="text-[20px] leading-none shrink-0">
              {syncStatus === "syncing" || syncStatus === "pulling"
                ? "⏳"
                : syncStatus === "error"
                  ? "⚠️"
                  : "☁️"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold leading-tight">{statusText}</div>
              {username && (
                <div className="text-[11px] text-pc-muted mt-0.5 font-semibold">
                  Inloggad som <span className="text-pc-orange">@{username}</span>
                </div>
              )}
              {dirty && (
                <div className="text-[11px] text-pc-muted mt-0.5 font-medium">
                  Det finns ändringar som inte nått molnet än.
                </div>
              )}
            </div>
            <button
              onClick={onPullNow}
              disabled={syncStatus === "pulling"}
              className="shrink-0 text-[12px] font-bold text-pc-orange underline"
            >
              Hämta nu
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-pc-muted font-medium mb-3 leading-snug">
          Synk är av. Dina data finns bara på den här enheten.
        </div>
      )}

      <div className="space-y-2">
        {!demo && !syncToken && (
          <button
            onClick={onSetupSync}
            className="pc-press w-full py-3.5 rounded-[16px] bg-pc-orange text-white font-bold text-[14px]"
          >
            Aktivera synkronisering
          </button>
        )}
        {!demo && (
          <button
            onClick={onOpenAccount}
            className="pc-press w-full py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
          >
            {syncToken
              ? "Hantera konto, synk-kod och felsökning"
              : "Profil, synk-konto och inställningar"}
          </button>
        )}
        {syncToken && syncStatus === "error" && (
          <button
            onClick={onSetupSync}
            className="pc-press w-full py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
          >
            Logga in igen
          </button>
        )}
      </div>
    </Sheet>
  );
}

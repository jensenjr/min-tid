import { useState, useEffect } from "react";
import {
  syncChangeSecret,
  syncSendPhoneCode,
  syncVerifyPhone,
  SYNC_PHONE_KEY,
} from "../lib/sync";

export type SettingsResult = {
  name: string;
  department?: string;
};

export default function SettingsModal({
  open,
  initialName,
  initialDepartment,
  syncToken,
  syncStatus,
  syncedAt,
  syncError,
  onClose,
  onSave,
  onSetupSync,
  onPullNow,
  onDisconnectSync,
  onDeleteSyncAccount,
  onOpenAutomation,
}: {
  open: boolean;
  initialName: string;
  initialDepartment?: string;
  syncToken: string | null;
  syncStatus: "idle" | "syncing" | "pulling" | "ok" | "error";
  syncedAt: number | null;
  syncError?: string | null;
  onClose: () => void;
  onSave: (r: SettingsResult) => void;
  onSetupSync: () => void;
  onPullNow: () => void;
  onDisconnectSync: () => void;
  onDeleteSyncAccount: () => void;
  onOpenAutomation: () => void;
}) {
  const [name, setName]             = useState(initialName);
  const [department, setDepartment] = useState(initialDepartment ?? "");
  const [nameErr, setNameErr]       = useState("");

  // Sync account management
  const [syncUsername, setSyncUsername] = useState<string | null>(null);
  const [syncPhone, setSyncPhone]       = useState<string | null>(null);

  // PIN change panel
  const [showPin, setShowPin]     = useState(false);
  const [newSecret, setNewSecret] = useState("");
  const [confirmSec, setConfirmSec] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [pinErr, setPinErr]         = useState("");
  const [pinDone, setPinDone]       = useState(false);

  // Phone panel  "idle" | "enter" | "code" | "done"
  const [phoneStep, setPhoneStep] = useState<"idle" | "enter" | "code" | "done">("idle");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode]   = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneErr, setPhoneErr]         = useState("");

  // "Radera konto" needs a second tap — it wipes the server copy for every device.
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDepartment(initialDepartment ?? "");
      setNameErr("");
      setSyncUsername(localStorage.getItem("sync_username"));
      setSyncPhone(localStorage.getItem(SYNC_PHONE_KEY));
      setShowPin(false);
      setNewSecret(""); setConfirmSec(""); setPinLoading(false); setPinErr(""); setPinDone(false);
      setPhoneStep("idle"); setPhoneInput(""); setPhoneCode(""); setPhoneLoading(false); setPhoneErr("");
      setConfirmDelete(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function handleSave() {
    if (!name.trim()) { setNameErr("Namn krävs."); return; }
    onSave({ name: name.trim(), department: department.trim() || undefined });
  }

  async function handlePinSave() {
    if (newSecret.length < 6) { setPinErr("Minst 6 tecken."); return; }
    if (newSecret !== confirmSec) { setPinErr("Koderna matchar inte."); return; }
    if (!syncToken) return;
    setPinLoading(true); setPinErr("");
    try {
      await syncChangeSecret(syncToken, newSecret);
      setPinDone(true);
      setShowPin(false);
      setNewSecret(""); setConfirmSec("");
    } catch (e) {
      setPinErr((e as Error).message);
    } finally {
      setPinLoading(false);
    }
  }

  async function handlePhoneSend() {
    const phone = phoneInput.trim();
    if (!phone) { setPhoneErr("Ange ditt mobilnummer."); return; }
    if (!syncToken) return;
    setPhoneLoading(true); setPhoneErr("");
    try {
      await syncSendPhoneCode(syncToken, phone);
      setPhoneStep("code");
    } catch (e) {
      setPhoneErr((e as Error).message);
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handlePhoneVerify() {
    const code = phoneCode.trim();
    if (code.length !== 6) { setPhoneErr("Koden är 6 siffror."); return; }
    if (!syncToken) return;
    setPhoneLoading(true); setPhoneErr("");
    try {
      await syncVerifyPhone(syncToken, phoneInput.trim(), code);
      // Normalize + save locally
      const normalized = phoneInput.trim().replace(/\D/g, "");
      const e164 = normalized.startsWith("46")
        ? "+" + normalized
        : normalized.startsWith("0")
          ? "+46" + normalized.slice(1)
          : "+" + normalized;
      localStorage.setItem(SYNC_PHONE_KEY, e164);
      setSyncPhone(e164);
      setPhoneStep("done");
    } catch (e) {
      setPhoneErr((e as Error).message);
    } finally {
      setPhoneLoading(false);
    }
  }

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

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Inställningar</div>
        <div className="text-[13px] text-pc-muted mb-6">Ändra namn och avdelning.</div>

        <SLabel>Namn <span className="text-pc-orange">*</span></SLabel>
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setNameErr(""); }}
          style={INPUT}
          placeholder="Ditt namn"
        />
        {nameErr && <p className="text-red-500 text-[13px] mb-3 font-semibold">{nameErr}</p>}

        <SLabel>Avdelning <span className="text-pc-muted font-medium normal-case tracking-normal">(valfri)</span></SLabel>
        <input
          type="text"
          value={department}
          onChange={e => setDepartment(e.target.value)}
          style={INPUT}
          placeholder="t.ex. Lager, Kontor…"
        />

        {/* Automation */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2 mt-2">Automatisering</div>
        <button
          onClick={onOpenAutomation}
          style={{ width: "100%", padding: "13px 16px", borderRadius: "14px", border: "1.5px solid #ece6df", fontSize: "14px", outline: "none", background: "#fdf6ee", fontWeight: 600, color: "#2d1717", marginBottom: "16px", boxSizing: "border-box", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
        >
          <span>⚡</span>
          <div>
            <div className="font-bold text-[13px]">Automatisera in/ut-checkning</div>
            <div className="text-[11px] text-[#9c7c5c] font-medium">QR-koder, NFC-taggar och WiFi via Genvägar</div>
          </div>
        </button>

        {/* Sync */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">Synkronisering</div>
        {syncToken ? (
          <>
            {/* Status card */}
            <div className="bg-[#fdf6ee] border border-[#ece6df] rounded-[16px] px-4 py-3 mb-3 flex items-center gap-3">
              <span className="text-[20px] leading-none shrink-0">
                {syncStatus === "syncing" || syncStatus === "pulling" ? "⏳" : syncStatus === "error" ? "⚠️" : "☁️"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-[#2d1717] leading-tight">
                  {syncStatus === "pulling" ? "Hämtar från molnet…"
                    : syncStatus === "syncing" ? "Synkroniserar…"
                    : syncStatus === "error" ? "Synkfel – försöker igen strax"
                    : syncedAt ? `Synkat ${new Date(syncedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`
                    : "Synkronisering aktiv"}
                </div>
                {syncUsername && (
                  <div className="text-[11px] text-[#9c7c5c] mt-0.5 font-semibold">
                    Inloggad som: <span className="text-[#ff5f00]">@{syncUsername}</span>
                  </div>
                )}
                {syncStatus === "error" && syncError && (
                  <div className="text-[11px] text-red-600 mt-0.5 font-semibold break-words">{syncError}</div>
                )}
              </div>
              <button
                onClick={onPullNow}
                disabled={syncStatus === "pulling"}
                className="shrink-0 text-[11px] font-bold text-[#ff5f00] underline"
              >
                Hämta nu
              </button>
            </div>

            <p className="text-[11px] text-[#9c7c5c] mb-3 leading-relaxed">
              Data hämtas automatiskt när appen öppnas eller tas fram igen. Tryck <span className="font-bold">Hämta nu</span>
              {" "}om du precis stämplat på en annan enhet.
            </p>

            {/* PIN done banner */}
            {pinDone && (
              <div className="bg-green-50 border border-green-200 rounded-[14px] px-4 py-2.5 mb-3 flex items-center gap-2">
                <span className="text-[16px]">✅</span>
                <span className="text-[12px] font-semibold text-green-800">Synk-koden uppdaterad.</span>
              </div>
            )}

            {/* PIN change */}
            <button
              onClick={() => { setShowPin(v => !v); setPinErr(""); setPinDone(false); setNewSecret(""); setConfirmSec(""); }}
              style={{ width: "100%", padding: "13px 16px", borderRadius: "14px", border: "1.5px solid #ece6df", fontSize: "14px", outline: "none", background: showPin ? "#fff" : "#fdf6ee", fontWeight: 600, color: "#2d1717", marginBottom: showPin ? "0" : "10px", boxSizing: "border-box", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
            >
              <span>🔑</span>
              <div className="flex-1">
                <div className="font-bold text-[13px]">Byt synk-kod</div>
                <div className="text-[11px] text-[#9c7c5c] font-medium">Välj en ny hemlig kod</div>
              </div>
              <span className="text-[11px] text-[#9c7c5c]">{showPin ? "↑" : "↓"}</span>
            </button>

            {showPin && (
              <div className="border border-[#ece6df] border-t-0 rounded-b-[14px] px-4 py-4 mb-3 bg-white">
                <input
                  type="password"
                  value={newSecret}
                  onChange={e => { setNewSecret(e.target.value); setPinErr(""); }}
                  style={{ ...INPUT, marginBottom: "8px" }}
                  placeholder="Ny synk-kod (minst 6 tecken)"
                />
                <input
                  type="password"
                  value={confirmSec}
                  onChange={e => { setConfirmSec(e.target.value); setPinErr(""); }}
                  style={{ ...INPUT, marginBottom: pinErr ? "4px" : "12px" }}
                  placeholder="Bekräfta ny synk-kod"
                />
                {pinErr && <p className="text-red-500 text-[12px] mb-3 font-semibold">{pinErr}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowPin(false); setNewSecret(""); setConfirmSec(""); setPinErr(""); }}
                    style={{ flex: 1, padding: "11px", borderRadius: "12px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "13px", color: "#2d1717" }}
                  >
                    Avbryt
                  </button>
                  <button
                    onClick={handlePinSave}
                    disabled={pinLoading}
                    style={{ flex: 1, padding: "11px", borderRadius: "12px", background: pinLoading ? "#f0e8df" : "#ff5f00", color: pinLoading ? "#c4a882" : "white", fontWeight: 700, fontSize: "13px" }}
                  >
                    {pinLoading ? "Sparar…" : "Spara"}
                  </button>
                </div>
              </div>
            )}

            {/* Phone recovery */}
            <div className="border border-[#ece6df] rounded-[14px] px-4 py-3 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[16px]">📱</span>
                <div className="font-bold text-[13px] text-[#2d1717]">Återhämtningsnummer</div>
              </div>
              {phoneStep === "idle" && (
                <>
                  <div className="text-[12px] text-[#9c7c5c] mb-2">
                    {syncPhone
                      ? <>Nummer: <span className="font-semibold text-[#2d1717]">{syncPhone}</span></>
                      : "Inget nummer kopplat. Lägg till för att kunna återhämta ditt konto via SMS."}
                  </div>
                  <button
                    onClick={() => { setPhoneStep("enter"); setPhoneErr(""); setPhoneInput(""); }}
                    className="text-[12px] font-bold text-[#ff5f00] underline"
                  >
                    {syncPhone ? "Ändra nummer" : "Lägg till nummer"}
                  </button>
                </>
              )}
              {phoneStep === "enter" && (
                <>
                  <p className="text-[12px] text-[#9c7c5c] mb-2">Ange ditt mobilnummer för att få en verifieringskod via SMS.</p>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={e => { setPhoneInput(e.target.value); setPhoneErr(""); }}
                    style={{ ...INPUT, marginBottom: phoneErr ? "4px" : "10px" }}
                    placeholder="t.ex. 0701234567"
                  />
                  {phoneErr && <p className="text-red-500 text-[12px] mb-2 font-semibold">{phoneErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setPhoneStep("idle"); setPhoneErr(""); }}
                      style={{ flex: 1, padding: "10px", borderRadius: "12px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "13px", color: "#2d1717" }}
                    >
                      Avbryt
                    </button>
                    <button
                      onClick={handlePhoneSend}
                      disabled={phoneLoading}
                      style={{ flex: 1, padding: "10px", borderRadius: "12px", background: phoneLoading ? "#f0e8df" : "#ff5f00", color: phoneLoading ? "#c4a882" : "white", fontWeight: 700, fontSize: "13px" }}
                    >
                      {phoneLoading ? "Skickar…" : "Skicka kod"}
                    </button>
                  </div>
                </>
              )}
              {phoneStep === "code" && (
                <>
                  <p className="text-[12px] text-[#9c7c5c] mb-2">
                    En 6-siffrig kod skickades till <span className="font-semibold">{phoneInput}</span>.
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={phoneCode}
                    onChange={e => { setPhoneCode(e.target.value.replace(/\D/g, "")); setPhoneErr(""); }}
                    style={{ ...INPUT, letterSpacing: "0.25em", marginBottom: phoneErr ? "4px" : "10px" }}
                    placeholder="123456"
                  />
                  {phoneErr && <p className="text-red-500 text-[12px] mb-2 font-semibold">{phoneErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setPhoneStep("enter"); setPhoneCode(""); setPhoneErr(""); }}
                      style={{ flex: 1, padding: "10px", borderRadius: "12px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "13px", color: "#2d1717" }}
                    >
                      ← Tillbaka
                    </button>
                    <button
                      onClick={handlePhoneVerify}
                      disabled={phoneLoading}
                      style={{ flex: 1, padding: "10px", borderRadius: "12px", background: phoneLoading ? "#f0e8df" : "#ff5f00", color: phoneLoading ? "#c4a882" : "white", fontWeight: 700, fontSize: "13px" }}
                    >
                      {phoneLoading ? "Verifierar…" : "Bekräfta"}
                    </button>
                  </div>
                </>
              )}
              {phoneStep === "done" && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[16px]">✅</span>
                  <span className="text-[12px] font-semibold text-green-800">Nummer sparat ({syncPhone}).</span>
                </div>
              )}
            </div>

            {/* Leaving sync — two clearly separated levels */}
            <div className="flex items-center justify-between gap-3 mb-4">
              <button
                onClick={onDisconnectSync}
                className="text-[12px] font-semibold text-[#9c7c5c] underline"
              >
                Koppla från här
              </button>
              <button
                onClick={() => { if (confirmDelete) { setConfirmDelete(false); onDeleteSyncAccount(); } else setConfirmDelete(true); }}
                className={`text-[12px] font-semibold underline ${confirmDelete ? "text-red-600" : "text-[#9c7c5c]"}`}
              >
                {confirmDelete ? "Tryck igen för att radera kontot" : "Radera synk-konto"}
              </button>
            </div>
            <p className="text-[11px] text-[#9c7c5c] mb-4 leading-relaxed">
              <span className="font-bold">Koppla från här</span> stänger bara av synk på den här enheten — kontot och dina
              data ligger kvar i molnet och du kan logga in igen. <span className="font-bold">Radera synk-konto</span> tar
              bort kontot och molnkopian för alla enheter.
            </p>
          </>
        ) : (
          <button
            onClick={onSetupSync}
            style={{ width: "100%", padding: "13px 16px", borderRadius: "14px", border: "1.5px solid #ece6df", fontSize: "14px", outline: "none", background: "#fdf6ee", fontWeight: 600, color: "#2d1717", marginBottom: "16px", boxSizing: "border-box", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
          >
            <span>☁️</span>
            <div>
              <div className="font-bold text-[13px]">Aktivera synkronisering</div>
              <div className="text-[11px] text-[#9c7c5c] font-medium">Synka data mellan dina enheter</div>
            </div>
          </button>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button
            onClick={onClose}
            style={{ padding: "15px", borderRadius: "16px", background: "#fdf6ee", border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "15px", color: "#2d1717" }}
          >
            Avbryt
          </button>
          <button
            onClick={handleSave}
            style={{ padding: "15px", borderRadius: "16px", background: "#ff5f00", color: "white", fontWeight: 700, fontSize: "15px", boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)" }}
          >
            Spara
          </button>
        </div>

        <div className="text-center text-[11px] text-pc-muted mt-5 font-medium">
          min-tid v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">{children}</div>;
}

const INPUT: React.CSSProperties = {
  width: "100%", padding: "13px 16px", borderRadius: "14px",
  border: "1.5px solid #ece6df", fontSize: "15px", outline: "none",
  background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
  marginBottom: "16px", boxSizing: "border-box",
};

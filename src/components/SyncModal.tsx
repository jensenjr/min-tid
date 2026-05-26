import { useState } from "react";
import { syncRegister, syncLogin, type SyncState } from "../lib/sync";

type Tab = "create" | "restore";

export default function SyncModal({
  open,
  onClose,
  onToken,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onToken: (token: string) => void;
  onRestore: (token: string, state: SyncState) => void;
}) {
  const [tab, setTab]           = useState<Tab>("create");
  const [username, setUsername] = useState("");
  const [secret, setSecret]     = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");
  const [done, setDone]         = useState(false);

  function reset() {
    setTab("create");
    setUsername("");
    setSecret("");
    setConfirm("");
    setLoading(false);
    setErr("");
    setDone(false);
  }

  if (!open) return null;

  function handleClose() { reset(); onClose(); }

  async function handleCreate() {
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      setErr("Användarnamnet måste vara 3–20 tecken (a–z, 0–9, _ eller -).");
      return;
    }
    if (secret.length < 6) { setErr("Minst 6 tecken i synk-koden."); return; }
    if (secret !== confirm) { setErr("Koderna matchar inte."); return; }
    setLoading(true); setErr("");
    try {
      const { token } = await syncRegister(username, secret);
      onToken(token);
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    if (!username) { setErr("Ange ditt användarnamn."); return; }
    if (!secret) { setErr("Ange din synk-kod."); return; }
    setLoading(true); setErr("");
    try {
      const { token, state } = await syncLogin(username, secret);
      if (state) {
        onRestore(token, state);
      } else {
        onToken(token);
      }
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "12px 14px",
    borderRadius: "14px", border: "1.5px solid #ece6df",
    fontSize: "16px", outline: "none",
    background: "#fdf6ee", fontWeight: 600, color: "#2d1717",
    marginBottom: "12px",
  };

  const focusStyle = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = "#ff5f00"; e.currentTarget.style.background = "#fff"; },
    onBlur:  (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = "#ece6df"; e.currentTarget.style.background = "#fdf6ee"; },
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={handleClose}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "90dvh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">☁️ Synkronisering</div>
        <div className="text-[13px] text-[#9c7c5c] mb-5 leading-relaxed">
          Synka dina data mellan enheter med ett användarnamn och en hemlig kod — ingen e-post, inga konton.
        </div>

        {done ? (
          <div className="text-center py-6">
            <div className="text-[40px] mb-3">✅</div>
            <div className="font-extrabold text-[18px] mb-1">Klart!</div>
            <div className="text-[13px] text-[#9c7c5c] mb-6">
              {tab === "create"
                ? "Din data synkroniseras nu automatiskt."
                : "Dina data har återställts och synkroniseras nu."}
            </div>
            <button
              onClick={handleClose}
              style={{
                padding: "14px 32px", borderRadius: "16px", background: "#ff5f00",
                color: "white", fontWeight: 700, fontSize: "15px",
                boxShadow: "0 8px 20px -8px rgba(255,95,0,0.6)",
              }}
            >
              Stäng
            </button>
          </div>
        ) : (
          <>
            {/* Tab toggle */}
            <div className="flex bg-[#fdf6ee] rounded-[16px] p-1 mb-5 border border-[#ece6df]">
              {(["create", "restore"] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setErr(""); setUsername(""); setSecret(""); setConfirm(""); }}
                  className={`flex-1 py-2 rounded-[12px] text-[13px] font-bold transition-colors ${
                    tab === t ? "bg-white text-[#2d1717] shadow-sm" : "text-[#9c7c5c]"
                  }`}
                >
                  {t === "create" ? "Ny synk-kod" : "Återställ"}
                </button>
              ))}
            </div>

            {/* Username field (shared across both tabs) */}
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
              Användarnamn
            </div>
            <input
              type="text"
              placeholder="t.ex. carl eller carl2"
              value={username}
              onChange={e => { setUsername(e.target.value); setErr(""); }}
              style={inputStyle}
              autoCapitalize="none"
              autoCorrect="off"
              {...focusStyle}
            />

            {tab === "create" && (
              <>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
                  Välj en synk-kod
                </div>
                <div className="text-[12px] text-[#9c7c5c] mb-3 leading-relaxed">
                  Välj en lång, unik fras eller kombination. Du behöver den för att logga in på nya enheter. Den lagras aldrig i klartext.
                </div>
                <input
                  type="password"
                  placeholder="Din synk-kod (minst 6 tecken)"
                  value={secret}
                  onChange={e => { setSecret(e.target.value); setErr(""); }}
                  style={inputStyle}
                  {...focusStyle}
                />
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
                  Bekräfta synk-koden
                </div>
                <input
                  type="password"
                  placeholder="Upprepa koden"
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); setErr(""); }}
                  style={inputStyle}
                  {...focusStyle}
                />
              </>
            )}

            {tab === "restore" && (
              <>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
                  Din synk-kod
                </div>
                <div className="text-[12px] text-[#9c7c5c] mb-3 leading-relaxed">
                  Ange det användarnamn och den synk-kod du skapade på din andra enhet. Din data hämtas och ersätter data på den här enheten.
                </div>
                <input
                  type="password"
                  placeholder="Din synk-kod"
                  value={secret}
                  onChange={e => { setSecret(e.target.value); setErr(""); }}
                  style={inputStyle}
                  {...focusStyle}
                />
              </>
            )}

            {err && (
              <div className="text-red-600 text-[13px] mb-3 font-semibold">{err}</div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-1">
              <button
                onClick={handleClose}
                style={{
                  padding: "14px", borderRadius: "14px", background: "#fdf6ee",
                  border: "1.5px solid #ece6df", fontWeight: 700, fontSize: "14px", color: "#2d1717",
                }}
              >
                Avbryt
              </button>
              <button
                onClick={tab === "create" ? handleCreate : handleRestore}
                disabled={loading}
                style={{
                  padding: "14px", borderRadius: "14px",
                  background: loading ? "#f0e8df" : "#ff5f00",
                  color: loading ? "#c4a882" : "white",
                  fontWeight: 700, fontSize: "14px",
                  boxShadow: loading ? "none" : "0 8px 20px -8px rgba(255,95,0,0.6)",
                }}
              >
                {loading ? "Vänta…" : tab === "create" ? "Skapa konto" : "Återställ"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

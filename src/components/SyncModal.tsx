import { useEffect, useState } from "react";
import {
  syncRegister,
  syncLogin,
  syncRecoverRequest,
  syncRecoverConfirm,
  syncRecoverUnlock,
  syncRecoverComplete,
  SYNC_TOKEN_KEY,
  SYNC_USERNAME_KEY,
  type RecoverySession,
  type SyncState,
} from "../lib/sync";
import RecoveryKeySheet from "./RecoveryKeySheet";

type Tab = "create" | "restore";
/**
 * setup:   no sync on this device yet — create an account or restore one (replaces local data).
 * relogin: this device already has a sync session that needs a fresh login (expired, no key
 *          since the switch to encryption, or the secret changed elsewhere). Logging in
 *          goes through onToken, so local data is kept and merged, never replaced.
 */
type Mode = "setup" | "relogin";
type RecoverStep = "phone" | "code" | "key" | "reset" | "secret";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export default function SyncModal({
  open,
  onClose,
  onToken,
  onRestore,
}: {
  open: boolean;
  onClose: () => void;
  onToken: (token: string, username: string) => void;
  onRestore: (token: string, state: SyncState, username: string, rev: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("setup");
  const [knownUser, setKnownUser] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("create");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showExplainer, setShowExplainer] = useState(false);

  // SMS recovery
  const [recovering, setRecovering] = useState(false);
  const [recoverStep, setRecoverStep] = useState<RecoverStep>("phone");
  const [recoverPhone, setRecoverPhone] = useState("");
  const [recoverCode, setRecoverCode] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [session, setSession] = useState<RecoverySession | null>(null);
  const [discard, setDiscard] = useState(false);
  const [discardOk, setDiscardOk] = useState(false);

  function resetRecovery() {
    setRecovering(false);
    setRecoverStep("phone");
    setRecoverPhone("");
    setRecoverCode("");
    setRecoveryKey("");
    setSession(null);
    setDiscard(false);
    setDiscardOk(false);
  }

  // The sheet stays mounted while closed: start fresh every time it opens.
  useEffect(() => {
    if (!open) return;
    const hasSession = !!localStorage.getItem(SYNC_TOKEN_KEY);
    const stored = localStorage.getItem(SYNC_USERNAME_KEY);
    setMode(hasSession ? "relogin" : "setup");
    setKnownUser(hasSession && stored ? stored : null);
    setTab(hasSession ? "restore" : "create");
    setUsername(hasSession && stored ? stored : "");
    setSecret("");
    setConfirm("");
    setLoading(false);
    setErr("");
    setShowExplainer(false);
    resetRecovery();
  }, [open]);

  function handleClose() {
    resetRecovery();
    onClose();
  }

  /** Hand a fresh session to PunchClock. Re-login and empty clouds keep local data. */
  function finish(token: string, user: string, state: SyncState | null, rev: number) {
    if (mode === "relogin" || !state) onToken(token, user);
    else onRestore(token, state, user, rev);
  }

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function validateNewSecret(): boolean {
    if (secret.length < 6) {
      setErr("Minst 6 tecken i synk-koden.");
      return false;
    }
    if (secret !== confirm) {
      setErr("Koderna matchar inte.");
      return false;
    }
    return true;
  }

  async function handleCreate() {
    if (!USERNAME_RE.test(username)) {
      setErr("Användarnamnet måste vara 3–20 tecken (a–z, 0–9, _ eller -).");
      return;
    }
    if (!validateNewSecret()) return;
    await run(async () => {
      // The recovery key sheet below picks the new key up by itself.
      const { token } = await syncRegister(username, secret);
      onToken(token, username);
    });
  }

  async function handleLogin() {
    if (!username) {
      setErr("Ange ditt användarnamn.");
      return;
    }
    if (!secret) {
      setErr("Ange din synk-kod.");
      return;
    }
    await run(async () => {
      const { token, state, updatedAt } = await syncLogin(username, secret);
      if (mode === "relogin") {
        onToken(token, username);
        return;
      }
      if (!state) {
        // Right credentials, but nothing stored yet — say so instead of quietly
        // "succeeding" with the local data still in place.
        throw new Error(
          "Inloggningen fungerade, men det finns inga data i molnet ännu. Öppna appen på din andra enhet (den laddar upp automatiskt) och försök igen.",
        );
      }
      onRestore(token, state, username, updatedAt);
    });
  }

  async function handleRecoverSend() {
    const phone = recoverPhone.trim();
    if (!phone) {
      setErr("Ange ditt mobilnummer.");
      return;
    }
    await run(async () => {
      await syncRecoverRequest(phone);
      setRecoverStep("code");
    });
  }

  async function handleRecoverConfirm() {
    const code = recoverCode.trim();
    if (code.length !== 6) {
      setErr("Koden är 6 siffror.");
      return;
    }
    await run(async () => {
      const s = await syncRecoverConfirm(recoverPhone.trim(), code);
      if (knownUser && s.username.toLowerCase() !== knownUser.toLowerCase()) {
        throw new Error(
          `Numret hör till kontot @${s.username}, inte @${knownUser}. Vill du byta konto: koppla från under Inställningar först.`,
        );
      }
      setSession(s);
      setSecret("");
      setConfirm("");
      setRecoverStep(s.needsRecoveryKey ? "key" : "secret");
    });
  }

  async function handleUnlock() {
    if (!session) return;
    await run(async () => {
      await syncRecoverUnlock(session, recoveryKey);
      setDiscard(false);
      setRecoverStep("secret");
    });
  }

  async function handleRecoverFinish() {
    if (!session || !validateNewSecret()) return;
    await run(async () => {
      const r = await syncRecoverComplete(session, secret, { discardCloudData: discard });
      resetRecovery();
      finish(r.token, r.username, r.state, r.updatedAt);
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    borderRadius: "14px",
    border: "1.5px solid #ece6df",
    fontSize: "16px",
    outline: "none",
    background: "#fdf6ee",
    fontWeight: 600,
    color: "#2d1717",
    marginBottom: "12px",
  };

  const focusStyle = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = "#ff5f00";
      e.currentTarget.style.background = "#fff";
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = "#ece6df";
      e.currentTarget.style.background = "#fdf6ee";
    },
  };

  const primaryBtn = (disabled = loading): React.CSSProperties => ({
    padding: "14px",
    borderRadius: "14px",
    background: disabled ? "#f0e8df" : "#ff5f00",
    color: disabled ? "#c4a882" : "white",
    fontWeight: 700,
    fontSize: "14px",
    boxShadow: disabled ? "none" : "0 8px 20px -8px rgba(255,95,0,0.6)",
  });

  const secondaryBtn: React.CSSProperties = {
    padding: "14px",
    borderRadius: "14px",
    background: "#fdf6ee",
    border: "1.5px solid #ece6df",
    fontWeight: 700,
    fontSize: "14px",
    color: "#2d1717",
  };

  const label = (text: string) => (
    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9c7c5c] mb-2">
      {text}
    </div>
  );

  const errorLine = err && <div className="text-red-600 text-[13px] mb-3 font-semibold">{err}</div>;

  const newSecretFields = (
    <>
      {label("Välj en synk-kod")}
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Din synk-kod (minst 6 tecken)"
        value={secret}
        onChange={(e) => {
          setSecret(e.target.value);
          setErr("");
        }}
        style={inputStyle}
        {...focusStyle}
      />
      {label("Bekräfta synk-koden")}
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Upprepa koden"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          setErr("");
        }}
        style={inputStyle}
        {...focusStyle}
      />
    </>
  );

  const encryptionStatus = (
    <div
      className="rounded-[16px] mb-5 overflow-hidden"
      style={{ background: "#ecfdf5", border: "1.5px solid #a7f3d0" }}
    >
      <button
        onClick={() => setShowExplainer((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
        aria-expanded={showExplainer}
      >
        <span className="text-[16px]">🔒</span>
        <span className="flex-1 text-[13px] font-extrabold" style={{ color: "#065f46" }}>
          Krypterad på enheten · AES-256
        </span>
        <span className="text-[11px] font-bold" style={{ color: "#047857" }}>
          {showExplainer ? "↑" : "Vad ser servern?"}
        </span>
      </button>
      {showExplainer && (
        <div className="px-4 pb-4 text-[12px] leading-relaxed" style={{ color: "#064e3b" }}>
          <p className="mb-2">
            <b>Servern ser inte</b> dina tider, frånvaro, utlägg, namn eller schema. Allt krypteras
            på enheten innan det skickas, med en nyckel som tas fram ur din synk-kod och aldrig
            lämnar enheten.
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
  );

  const backFromRecovery = (
    <button
      onClick={() => {
        resetRecovery();
        setSecret("");
        setConfirm("");
        setErr("");
      }}
      className="text-[13px] font-semibold text-[#9c7c5c] mb-4 flex items-center gap-1"
    >
      ← Tillbaka
    </button>
  );

  function recoveryBody() {
    switch (recoverStep) {
      case "phone":
        return (
          <>
            <div className="font-extrabold text-[18px] mb-1">📱 Återställ med SMS</div>
            <p className="text-[13px] text-[#9c7c5c] mb-2 leading-relaxed">
              Ange mobilnumret du kopplat till kontot så skickar vi en verifieringskod.
            </p>
            <p className="text-[12px] text-[#7c2d12] mb-4 leading-relaxed font-semibold">
              SMS-koden ger dig tillbaka kontot. Dina data kan bara låsas upp med din
              återställningsnyckel.
            </p>
            <input
              type="tel"
              autoComplete="tel"
              placeholder="t.ex. 0701234567"
              value={recoverPhone}
              onChange={(e) => {
                setRecoverPhone(e.target.value);
                setErr("");
              }}
              style={inputStyle}
              {...focusStyle}
            />
            {errorLine}
            <button
              onClick={handleRecoverSend}
              disabled={loading}
              style={{ ...primaryBtn(), width: "100%" }}
            >
              {loading ? "Skickar…" : "Skicka kod →"}
            </button>
          </>
        );
      case "code":
        return (
          <>
            <div className="font-extrabold text-[18px] mb-1">Ange verifieringskod</div>
            <p className="text-[13px] text-[#9c7c5c] mb-4 leading-relaxed">
              En 6-siffrig kod skickades till <span className="font-semibold">{recoverPhone}</span>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              value={recoverCode}
              onChange={(e) => {
                setRecoverCode(e.target.value.replace(/\D/g, ""));
                setErr("");
              }}
              style={{ ...inputStyle, letterSpacing: "0.3em" }}
              {...focusStyle}
            />
            {errorLine}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setRecoverStep("phone");
                  setRecoverCode("");
                  setErr("");
                }}
                style={secondaryBtn}
              >
                ← Tillbaka
              </button>
              <button onClick={handleRecoverConfirm} disabled={loading} style={primaryBtn()}>
                {loading ? "Verifierar…" : "Bekräfta"}
              </button>
            </div>
          </>
        );
      case "key":
        return (
          <>
            <div className="font-extrabold text-[18px] mb-1">🔑 Lås upp dina data</div>
            <p className="text-[13px] text-[#9c7c5c] mb-4 leading-relaxed">
              Kontot <span className="font-bold text-[#ff5f00]">@{session?.username}</span> är
              återställt. Ange din återställningsnyckel (24 tecken) för att låsa upp datan i molnet.
            </p>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              value={recoveryKey}
              onChange={(e) => {
                setRecoveryKey(e.target.value);
                setErr("");
              }}
              style={{
                ...inputStyle,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
              {...focusStyle}
            />
            {errorLine}
            <button
              onClick={handleUnlock}
              disabled={loading}
              style={{ ...primaryBtn(), width: "100%" }}
            >
              {loading ? "Låser upp…" : "Lås upp →"}
            </button>
            <div className="mt-5 pt-4 border-t border-[#ece6df] text-center">
              <button
                onClick={() => {
                  setErr("");
                  setDiscardOk(false);
                  setRecoverStep("reset");
                }}
                className="text-[13px] font-bold text-[#9c7c5c] underline"
              >
                Jag har ingen återställningsnyckel
              </button>
            </div>
          </>
        );
      case "reset":
        return (
          <>
            <div className="font-extrabold text-[18px] mb-1">Börja om utan molnets data?</div>
            <div
              className="rounded-[14px] px-4 py-3 mb-4 text-[12px] leading-relaxed"
              style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", color: "#7f1d1d" }}
            >
              Utan återställningsnyckeln går datan i molnet inte att låsa upp — inte ens för oss. Du
              kan behålla kontot och börja om: molnkopian raderas och ersätts med datan på den här
              enheten.
              <br />
              <br />
              Har du appen kvar på en annan enhet finns dess data kvar där. Logga in där med den nya
              synk-koden så slås den ihop med molnet igen.
            </div>
            <label className="flex items-start gap-3 mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={discardOk}
                onChange={(e) => setDiscardOk(e.target.checked)}
                className="mt-0.5 w-5 h-5 shrink-0"
                style={{ accentColor: "#dc2626" }}
              />
              <span className="text-[13px] font-semibold text-[#2d1717] leading-snug">
                Jag förstår att datan i molnet raderas.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setRecoverStep("key")} style={secondaryBtn}>
                ← Tillbaka
              </button>
              <button
                onClick={() => {
                  setDiscard(true);
                  setSecret("");
                  setConfirm("");
                  setRecoverStep("secret");
                }}
                disabled={!discardOk}
                style={{
                  ...secondaryBtn,
                  background: discardOk ? "#dc2626" : "#f0e8df",
                  border: "none",
                  color: discardOk ? "white" : "#c4a882",
                }}
              >
                Börja om
              </button>
            </div>
          </>
        );
      case "secret":
        return (
          <>
            <div className="font-extrabold text-[18px] mb-1">Välj en ny synk-kod</div>
            <p className="text-[13px] text-[#9c7c5c] mb-4 leading-relaxed">
              {discard
                ? "Molnkopian ersätts med datan på den här enheten, krypterad med den nya koden."
                : session?.needsRecoveryKey
                  ? "Datan är upplåst. Välj en ny synk-kod — den gamla slutar gälla, och du får en ny återställningsnyckel."
                  : "Välj en ny synk-kod för kontot. Du får också en återställningsnyckel att spara."}
            </p>
            {newSecretFields}
            {errorLine}
            <button
              onClick={handleRecoverFinish}
              disabled={loading}
              style={{ ...primaryBtn(), width: "100%" }}
            >
              {loading ? "Sparar…" : "Spara och synka →"}
            </button>
          </>
        );
    }
  }

  return (
    <>
      {open && (
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#ece6df] rounded-full mx-auto mb-5" />

            <div className="font-extrabold text-[22px] tracking-tight mb-1">
              {mode === "relogin" ? "🔑 Logga in igen" : "☁️ Synkronisering"}
            </div>
            <div className="text-[13px] text-[#9c7c5c] mb-4 leading-relaxed">
              {mode === "relogin"
                ? "Synken på den här enheten behöver en ny inloggning. Dina lokala data ligger kvar och slås ihop med molnet."
                : "Synka dina data mellan enheter med ett användarnamn och en hemlig kod — ingen e-post, inga konton."}
            </div>

            {encryptionStatus}

            {recovering ? (
              <>
                {backFromRecovery}
                {recoveryBody()}
              </>
            ) : (
              <>
                {mode === "setup" && (
                  <div className="flex bg-[#fdf6ee] rounded-[16px] p-1 mb-5 border border-[#ece6df]">
                    {(["create", "restore"] as Tab[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setTab(t);
                          setErr("");
                          setUsername("");
                          setSecret("");
                          setConfirm("");
                        }}
                        className={`flex-1 py-2 rounded-[12px] text-[13px] font-bold transition-colors ${
                          tab === t ? "bg-white text-[#2d1717] shadow-sm" : "text-[#9c7c5c]"
                        }`}
                      >
                        {t === "create" ? "Ny synk-kod" : "Återställ"}
                      </button>
                    ))}
                  </div>
                )}

                {knownUser ? (
                  <div className="text-[13px] text-[#9c7c5c] mb-3">
                    Konto: <span className="font-bold text-[#ff5f00]">@{knownUser}</span>
                  </div>
                ) : (
                  <>
                    {label("Användarnamn")}
                    <input
                      type="text"
                      autoComplete="username"
                      placeholder="t.ex. carl eller carl2"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setErr("");
                      }}
                      style={inputStyle}
                      autoCapitalize="none"
                      autoCorrect="off"
                      {...focusStyle}
                    />
                  </>
                )}

                {mode === "setup" && tab === "create" ? (
                  <>
                    <div className="text-[12px] text-[#9c7c5c] mb-3 leading-relaxed">
                      Välj en lång, unik fras. Du behöver den för att logga in på nya enheter, och
                      den är nyckeln till din krypterade data.
                    </div>
                    {newSecretFields}
                    <div className="text-[12px] text-[#9c7c5c] mb-3 leading-relaxed">
                      När kontot skapas får du en <b>återställningsnyckel</b>. Spara den — utan den
                      går dina data inte att låsa upp om du glömmer synk-koden.
                    </div>
                  </>
                ) : (
                  <>
                    {label("Din synk-kod")}
                    {mode === "setup" && (
                      <div className="text-[12px] text-[#9c7c5c] mb-3 leading-relaxed">
                        Ange det användarnamn och den synk-kod du skapade på din andra enhet.
                      </div>
                    )}
                    <input
                      type="password"
                      autoComplete="current-password"
                      placeholder="Din synk-kod"
                      value={secret}
                      onChange={(e) => {
                        setSecret(e.target.value);
                        setErr("");
                      }}
                      style={inputStyle}
                      {...focusStyle}
                    />
                  </>
                )}

                {errorLine}

                <div className="grid grid-cols-2 gap-3 mt-1">
                  <button onClick={handleClose} style={secondaryBtn}>
                    Avbryt
                  </button>
                  <button
                    onClick={mode === "setup" && tab === "create" ? handleCreate : handleLogin}
                    disabled={loading}
                    style={primaryBtn()}
                  >
                    {loading
                      ? "Vänta…"
                      : mode === "relogin"
                        ? "Logga in"
                        : tab === "create"
                          ? "Skapa konto"
                          : "Återställ"}
                  </button>
                </div>

                {(mode === "relogin" || tab === "restore") && (
                  <div className="mt-5 pt-4 border-t border-[#ece6df] text-center">
                    <div className="text-[12px] text-[#9c7c5c] mb-2">
                      {mode === "relogin"
                        ? "Glömt synk-koden?"
                        : "Glömt ditt användarnamn eller synk-kod?"}
                    </div>
                    <button
                      onClick={() => {
                        setRecovering(true);
                        setErr("");
                      }}
                      className="text-[13px] font-bold text-[#ff5f00] underline"
                    >
                      📱 Återställ med mobilnummer
                    </button>
                    {mode === "relogin" && (
                      <div className="text-[11px] text-[#9c7c5c] mt-3">
                        Vill du byta konto? Koppla från under Inställningar först.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Mounted even while closed: shows a new recovery key after create, migration,
          SMS recovery or a secret change made from the settings sheet. */}
      <RecoveryKeySheet />
    </>
  );
}

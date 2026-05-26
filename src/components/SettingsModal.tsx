import { useState, useEffect } from "react";

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
  onClose,
  onSave,
  onSetupSync,
  onDisconnectSync,
}: {
  open: boolean;
  initialName: string;
  initialDepartment?: string;
  syncToken: string | null;
  syncStatus: "idle" | "syncing" | "ok" | "error";
  syncedAt: number | null;
  onClose: () => void;
  onSave: (r: SettingsResult) => void;
  onSetupSync: () => void;
  onDisconnectSync: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [department, setDepartment] = useState(initialDepartment ?? "");
  const [nameErr, setNameErr] = useState("");

  // Sync from props every time the modal opens
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDepartment(initialDepartment ?? "");
      setNameErr("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  function handleSave() {
    if (!name.trim()) { setNameErr("Namn krävs."); return; }
    onSave({
      name: name.trim(),
      department: department.trim() || undefined,
    });
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
        {/* Handle */}
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Inställningar</div>
        <div className="text-[13px] text-pc-muted mb-6">Ändra namn och avdelning.</div>

        {/* Name */}
        <SLabel>Namn <span className="text-pc-orange">*</span></SLabel>
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setNameErr(""); }}
          style={INPUT}
          placeholder="Ditt namn"
        />
        {nameErr && <p className="text-red-500 text-[13px] mb-3 font-semibold">{nameErr}</p>}

        {/* Department */}
        <SLabel>Avdelning <span className="text-pc-muted font-medium normal-case tracking-normal">(valfri)</span></SLabel>
        <input
          type="text"
          value={department}
          onChange={e => setDepartment(e.target.value)}
          style={INPUT}
          placeholder="t.ex. Lager, Kontor…"
        />

        {/* Sync section */}
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2 mt-2">Synkronisering</div>
        {syncToken ? (
          <div className="bg-[#fdf6ee] border border-[#ece6df] rounded-[16px] px-4 py-3 mb-4 flex items-center gap-3">
            <span className="text-[20px] leading-none shrink-0">
              {syncStatus === "syncing" ? "⏳" : syncStatus === "error" ? "⚠️" : "☁️"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-[#2d1717] leading-tight">
                {syncStatus === "syncing" ? "Synkroniserar…"
                  : syncStatus === "error" ? "Synkfel – försöker snart igen"
                  : syncedAt ? `Synkat ${new Date(syncedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`
                  : "Synkronisering aktiv"}
              </div>
              <div className="text-[11px] text-[#9c7c5c] mt-0.5">Data sparas på alla dina enheter</div>
            </div>
            <button
              onClick={onDisconnectSync}
              className="shrink-0 text-[11px] font-semibold text-[#9c7c5c] underline"
            >
              Koppla från
            </button>
          </div>
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

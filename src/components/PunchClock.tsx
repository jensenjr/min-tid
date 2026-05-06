import { useState, useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────
const LUNCH_MINUTES = 45;
const LUNCH_THRESHOLD_HOURS = 5;
const STORAGE_KEY = "punchclock_v2";

// ─── Helpers ──────────────────────────────────────────────────
function now() { return Date.now(); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function fmtTime(ms: number | null | undefined) {
  if (!ms) return "--:--";
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDur(minutes: number, showLunch = false) {
  if (minutes <= 0) return "0h 0min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  let s = h > 0 ? `${h}h ${m}min` : `${m}min`;
  if (showLunch) s += " (inkl. 45min lunch avdragen)";
  return s;
}

function applyLunchRule(rawMinutes: number) {
  if (rawMinutes > LUNCH_THRESHOLD_HOURS * 60) {
    return { net: rawMinutes - LUNCH_MINUTES, lunchDeducted: true };
  }
  return { net: rawMinutes, lunchDeducted: false };
}

type Session = { id: string; checkIn: number; checkOut: number | null; manual: boolean };

function computeDayMinutes(sessions: Session[]) {
  let raw = 0;
  for (const s of sessions) {
    const end = s.checkOut ?? now();
    raw += (end - s.checkIn) / 60000;
  }
  const { net, lunchDeducted } = applyLunchRule(raw);
  return { raw, net, lunchDeducted };
}

function groupByDate(sessions: Session[]) {
  const map: Record<string, Session[]> = {};
  for (const s of sessions) {
    const d = new Date(s.checkIn).toISOString().slice(0, 10);
    if (!map[d]) map[d] = [];
    map[d].push(s);
  }
  return map;
}

function fmtDateLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
}

function buildShareText(sessions: Session[], name: string) {
  const byDate = groupByDate(sessions);
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 14);
  const lines = [`⏱ Tidrapport${name ? " – " + name : ""}\n`];
  let totalNet = 0;
  for (const d of dates) {
    const { net, lunchDeducted } = computeDayMinutes(byDate[d]);
    totalNet += net;
    const h = Math.floor(net / 60), m = Math.round(net % 60);
    lines.push(`${fmtDateLabel(d)}: ${h}h ${m}min${lunchDeducted ? " (lunch -45min)" : ""}`);
    for (const s of byDate[d]) {
      lines.push(`  ${fmtTime(s.checkIn)} → ${s.checkOut ? fmtTime(s.checkOut) : "pågår"}${s.manual ? " ✏️" : ""}`);
    }
  }
  lines.push(`\nTotal: ${Math.floor(totalNet / 60)}h ${Math.round(totalNet % 60)}min`);
  lines.push(`\nGenererat ${new Date().toLocaleString("sv-SE")}`);
  return lines.join("\n");
}

// ─── Storage ──────────────────────────────────────────────────
function load(): { name: string; sessions: Session[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { name: "", sessions: [] };
  } catch { return { name: "", sessions: [] }; }
}

function save(data: { name: string; sessions: Session[] }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {
    /* ignore */
  }
}

// ─── Main App ─────────────────────────────────────────────────
export default function PunchClock() {
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [, setTick] = useState(0);
  const [view, setView] = useState<"clock" | "history" | "share">("clock");
  const [addModal, setAddModal] = useState(false);
  const [shareText, setShareText] = useState("");
  const [shared, setShared] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const d = load();
    setName(d.name || "");
    setSessions(d.sessions || []);
    if (!d.name) setEditingName(true);
  }, []);

  useEffect(() => {
    save({ name, sessions });
  }, [name, sessions]);

  const activeSession = sessions.find(s => !s.checkOut);
  const todaySessions = sessions.filter(s => new Date(s.checkIn).toISOString().slice(0, 10) === todayStr());
  const { net: todayNet, lunchDeducted } = computeDayMinutes(todaySessions);
  void todayNet;
  const isIn = !!activeSession;

  function handlePunch() {
    if (isIn && activeSession) {
      setSessions(prev => prev.map(s =>
        s.id === activeSession.id ? { ...s, checkOut: now() } : s
      ));
    } else {
      setSessions(prev => [...prev, {
        id: crypto.randomUUID(),
        checkIn: now(),
        checkOut: null,
        manual: false,
      }]);
    }
  }

  function handleShare() {
    const txt = buildShareText(sessions, name);
    setShareText(txt);
    setView("share");
    setShared(false);
  }

  async function doCopy() {
    try {
      await navigator.clipboard.writeText(shareText);
      setShared(true);
    } catch { /* ignore */ }
  }

  async function doNativeShare() {
    if (navigator.share) {
      try { await navigator.share({ title: "Tidrapport", text: shareText }); setShared(true); } catch { /* ignore */ }
    } else { doCopy(); }
  }

  const liveMs = activeSession ? (now() - activeSession.checkIn) : 0;
  const liveTotalRaw = todaySessions.reduce((a, s) => a + ((s.checkOut ?? now()) - s.checkIn), 0) / 60000;
  const { net: liveNet } = applyLunchRule(liveTotalRaw);

  return (
    <div className="min-h-screen bg-pc-bg font-display text-pc-ink antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .pc-fade { animation: pcFade 0.35s cubic-bezier(0.16,1,0.3,1); }
        @keyframes pcFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .pc-pop { animation: pcPop 0.4s cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes pcPop { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        .pc-pulse-ring::before {
          content: ''; position: absolute; inset: -8px; border-radius: 50%;
          border: 2px solid #ff5f00; opacity: 0.6;
          animation: pcRing 2s ease-out infinite;
        }
        @keyframes pcRing {
          0% { transform: scale(0.95); opacity: 0.6; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        .pc-press:active { transform: scale(0.96); }
        .pc-press { transition: transform 0.15s, box-shadow 0.2s; }
        .pc-sheet { animation: pcSheet 0.32s cubic-bezier(0.32,0.72,0,1); }
        @keyframes pcSheet { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .pc-overlay { animation: pcOverlay 0.25s ease; }
        @keyframes pcOverlay { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      <div className="mx-auto max-w-[480px] min-h-screen flex flex-col relative pb-[88px]">
        {/* Status bar safe area */}
        <div className="h-[env(safe-area-inset-top,0px)]" />

        {/* Header */}
        <header className="px-5 pt-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-pc-orange flex items-center justify-center shadow-[0_4px_14px_rgba(255,95,0,0.35)]">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pc-muted">Tidrapport</div>
              {editingName ? (
                <input
                  ref={nameRef}
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={() => { if (name.trim()) setEditingName(false); }}
                  onKeyDown={e => { if (e.key === "Enter" && name.trim()) setEditingName(false); }}
                  placeholder="Ditt namn..."
                  className="border-none border-b-2 border-pc-orange outline-none text-[17px] font-bold bg-transparent w-44 py-0.5"
                  style={{ borderBottom: "2px solid #ff5f00" }}
                />
              ) : (
                <button onClick={() => setEditingName(true)} className="text-[17px] font-bold leading-tight">
                  {name || "Sätt namn"}
                </button>
              )}
            </div>
          </div>
          {isIn && (
            <div className="flex items-center gap-1.5 bg-pc-orange/10 text-pc-orange-deep px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-pc-orange animate-pulse" />
              <span className="text-[12px] font-bold">LIVE</span>
            </div>
          )}
        </header>

        <main className="flex-1 px-5">
          {view === "clock" && (
            <div className="pc-fade">
              {/* Hero punch */}
              <div className="text-center mt-6 mb-10">
                <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-pc-muted mb-6">
                  {isIn ? "Du är incheckad" : "Inte incheckad"}
                </div>
                <div className="relative inline-block">
                  {isIn && <span className="pc-pulse-ring absolute inset-0 rounded-full" />}
                  <button
                    onClick={handlePunch}
                    className="pc-press relative w-[200px] h-[200px] rounded-full text-white font-extrabold flex flex-col items-center justify-center gap-1.5"
                    style={{
                      background: isIn
                        ? "linear-gradient(145deg, #ff5f00 0%, #fb4f00 100%)"
                        : "linear-gradient(145deg, #512b2b 0%, #2d1717 100%)",
                      boxShadow: isIn
                        ? "0 18px 48px -12px rgba(255,95,0,0.55), inset 0 1px 0 rgba(255,255,255,0.2)"
                        : "0 18px 48px -12px rgba(81,43,43,0.45), inset 0 1px 0 rgba(255,255,255,0.1)",
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      {isIn ? (
                        <><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></>
                      ) : (
                        <><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" /></>
                      )}
                    </svg>
                    <span className="text-[19px] tracking-tight">{isIn ? "Checka ut" : "Checka in"}</span>
                  </button>
                </div>
                {isIn && activeSession && (
                  <div className="mt-7 pc-pop">
                    <div className="text-[34px] font-extrabold tabular-nums tracking-tight text-pc-ink">
                      {fmtDur(liveMs / 60000)}
                    </div>
                    <div className="text-[13px] text-pc-muted font-medium mt-0.5">
                      Sedan {fmtTime(activeSession.checkIn)}
                    </div>
                  </div>
                )}
              </div>

              {/* Today card */}
              <section className="bg-white rounded-[24px] p-5 mb-3 shadow-[0_2px_12px_rgba(81,43,43,0.04)] border border-pc-line">
                <div className="flex items-baseline justify-between mb-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-pc-muted">Idag</div>
                  <div className="text-[12px] font-semibold text-pc-muted capitalize">
                    {new Date().toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Netto arbetstid" value={fmtDur(liveNet)} accent />
                  <Stat label="Antal pass" value={`${todaySessions.length} st`} />
                </div>
                {lunchDeducted && (
                  <div className="mt-3 bg-pc-peach text-pc-orange-deep rounded-2xl px-4 py-3 text-[13px] font-semibold flex items-center gap-2">
                    <span>🥪</span> 45 min lunch avdragen (över 5h)
                  </div>
                )}
                {todaySessions.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-pc-line space-y-2">
                    {todaySessions.map((s, i) => (
                      <div key={s.id} className="flex justify-between text-[14px]">
                        <span className="text-pc-muted font-medium">Pass {i + 1}{s.manual ? " ✏️" : ""}</span>
                        <span className="font-semibold tabular-nums">
                          {fmtTime(s.checkIn)} → {s.checkOut ? fmtTime(s.checkOut) : <span className="text-pc-orange">pågår</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <button
                onClick={() => setAddModal(true)}
                className="pc-press w-full bg-white border border-pc-line rounded-[20px] py-4 font-bold text-[15px] text-pc-ink flex items-center justify-center gap-2"
              >
                <span className="text-pc-orange text-xl leading-none">+</span> Lägg till tid manuellt
              </button>
            </div>
          )}

          {view === "history" && (
            <div className="pc-fade pt-2">
              <h1 className="text-[28px] font-extrabold tracking-tight mb-5">Historik</h1>
              {sessions.length === 0 && (
                <div className="text-center text-pc-muted py-20 text-[15px]">
                  <div className="text-4xl mb-3 opacity-40">📋</div>
                  Inga registrerade tider ännu.
                </div>
              )}
              <div className="space-y-3">
                {Object.entries(groupByDate(sessions))
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([date, daySessions]) => {
                    const { net, lunchDeducted } = computeDayMinutes(daySessions);
                    return (
                      <div key={date} className="bg-white rounded-[20px] p-4 border border-pc-line shadow-[0_2px_12px_rgba(81,43,43,0.04)]">
                        <div className="flex justify-between items-baseline mb-2">
                          <div className="font-bold text-[15px] capitalize">{fmtDateLabel(date)}</div>
                          <div className="font-extrabold text-pc-orange text-[15px] tabular-nums">{fmtDur(net)}</div>
                        </div>
                        {lunchDeducted && <div className="text-[12px] text-pc-orange-deep mb-2 font-semibold">🥪 -45min lunch avdragen</div>}
                        <div className="space-y-1 pt-2 border-t border-pc-line">
                          {daySessions.map(s => (
                            <div key={s.id} className="flex justify-between text-[13px] py-1">
                              <span className="text-pc-ink/80 font-medium tabular-nums">
                                {fmtTime(s.checkIn)} → {s.checkOut ? fmtTime(s.checkOut) : "pågår"}{s.manual ? " ✏️" : ""}
                              </span>
                              <span className="text-pc-muted tabular-nums">{fmtDur((((s.checkOut ?? now()) - s.checkIn) / 60000))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {view === "share" && (
            <div className="pc-fade pt-2">
              <button onClick={() => setView("clock")} className="text-pc-orange font-semibold text-[15px] mb-3 flex items-center gap-1">
                ← Tillbaka
              </button>
              <h1 className="text-[28px] font-extrabold tracking-tight mb-1">Dela rapport</h1>
              <p className="text-[14px] text-pc-muted mb-5">Kopiera eller dela som text — till dig själv eller din chef.</p>
              <textarea
                readOnly
                value={shareText}
                className="w-full min-h-[280px] border border-pc-line rounded-[18px] p-4 text-[13px] leading-[1.7] bg-white text-pc-ink resize-none outline-none"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button onClick={doCopy} className="pc-press py-4 rounded-[18px] bg-white border border-pc-line text-pc-ink font-bold text-[15px]">
                  {shared ? "✓ Kopierat!" : "Kopiera"}
                </button>
                <button onClick={doNativeShare} className="pc-press py-4 rounded-[18px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]">
                  Dela
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Bottom nav */}
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white/85 backdrop-blur-xl border-t border-pc-line px-2"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)" }}
        >
          <div className="grid grid-cols-3 gap-1 pt-2">
            <NavItem active={view === "clock"} onClick={() => setView("clock")} label="Klocka" icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            } />
            <NavItem active={view === "history"} onClick={() => setView("history")} label="Historik" icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
            } />
            <NavItem active={view === "share"} onClick={handleShare} label="Dela" icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 3v13" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" /></svg>
            } />
          </div>
        </nav>
      </div>

      {addModal && <AddTimeModal onClose={() => setAddModal(false)} onSave={(s) => {
        setSessions(prev => [...prev, s]);
        setAddModal(false);
      }} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-pc-apricot rounded-2xl px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1">{label}</div>
      <div className={`text-[22px] font-extrabold tabular-nums tracking-tight ${accent ? "text-pc-orange-deep" : "text-pc-ink"}`}>{value}</div>
    </div>
  );
}

function NavItem({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl transition-colors ${active ? "text-pc-orange" : "text-pc-muted"}`}
    >
      {icon}
      <span className="text-[10px] font-bold tracking-wide">{label}</span>
    </button>
  );
}

function AddTimeModal({ onClose, onSave }: { onClose: () => void; onSave: (s: Session) => void }) {
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [err, setErr] = useState("");

  function handleSave() {
    if (!startTime) { setErr("Ange starttid."); return; }
    const checkIn = new Date(`${date}T${startTime}`).getTime();
    const checkOut = endTime ? new Date(`${date}T${endTime}`).getTime() : null;
    if (checkOut && checkOut <= checkIn) { setErr("Sluttid måste vara efter starttid."); return; }
    onSave({ id: crypto.randomUUID(), checkIn, checkOut, manual: true });
  }

  const previewMs = startTime && endTime
    ? new Date(`${date}T${endTime}`).getTime() - new Date(`${date}T${startTime}`).getTime()
    : null;
  const previewMin = previewMs ? previewMs / 60000 : null;
  const { net: previewNet, lunchDeducted: previewLunch } = previewMin ? applyLunchRule(previewMin) : { net: 0, lunchDeducted: false };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pc-overlay" style={{ background: "rgba(45,23,23,0.55)" }} onClick={onClose}>
      <div className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-6 pt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        <div className="font-extrabold text-[22px] tracking-tight mb-1">Lägg till tid</div>
        <div className="text-[13px] text-pc-muted mb-6">Välj datum, start och sluttid. Lunchen dras automatiskt om du jobbat mer än 5h.</div>

        <Label>Datum</Label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="pc-input" />

        <Label>Starttid</Label>
        <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="pc-input" />

        <Label>Sluttid (valfri – lämna tom om pågående)</Label>
        <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="pc-input" />

        {previewMin !== null && previewMin > 0 && (
          <div className="bg-pc-peach rounded-2xl px-4 py-3 mb-4 text-[13px]">
            <div className="font-extrabold text-pc-orange-deep mb-0.5 text-[15px]">
              Netto: {fmtDur(previewNet)}
            </div>
            {previewLunch && <div className="text-pc-orange-deep/80">🥪 45min lunch dras av (mer än 5h)</div>}
            {!previewLunch && <div className="text-pc-muted">Ingen lunchavdrag (under 5h)</div>}
          </div>
        )}

        {err && <div className="text-red-600 text-[13px] mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mt-2">
          <button onClick={onClose} className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink">
            Avbryt
          </button>
          <button onClick={handleSave} className="pc-press py-4 rounded-[16px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]">
            Spara
          </button>
        </div>

        <style>{`
          .pc-input {
            width: 100%; padding: 14px 16px; border-radius: 16px;
            border: 1px solid #ece6df; font-size: 16px; outline: none;
            margin-bottom: 16px; background: #fdf6ee; font-weight: 600;
            color: #2d1717;
          }
          .pc-input:focus { border-color: #ff5f00; background: #fff; }
        `}</style>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">{children}</div>;
}

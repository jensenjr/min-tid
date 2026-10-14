// Small presentational pieces shared by the views and sheets. Nothing here knows about
// app state — it only renders what it is given.
import { useState, type ReactNode } from "react";
import { SOURCE_META } from "../lib/actions";
import { fmtMin } from "../lib/schedule";
import { fmtDur, fmtTime } from "../lib/format";
import type { Session } from "../lib/types";

// ─── Icons ────────────────────────────────────────────────────
type IconProps = { className?: string };

function Svg({
  className = "w-4 h-4",
  strokeWidth = 2.2,
  children,
}: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconEdit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Svg>
  );
}

export function IconLock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={3}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function IconChevron(p: IconProps) {
  return (
    <Svg {...p}>
      <polyline points="9 18 15 12 9 6" />
    </Svg>
  );
}

export function IconCalendarX(p: IconProps) {
  return (
    <Svg {...p} className={p.className ?? "w-5 h-5"}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="10" y1="14" x2="14" y2="18" />
      <line x1="14" y1="14" x2="10" y2="18" />
    </Svg>
  );
}

export function IconSliders(p: IconProps) {
  return (
    <Svg {...p} className={p.className ?? "w-5 h-5"}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </Svg>
  );
}

// Bottom-nav icons
export const NAV_ICONS = {
  today: (
    <Svg className="w-6 h-6" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  calendar: (
    <Svg className="w-6 h-6" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
  ),
  report: (
    <Svg className="w-6 h-6" strokeWidth={2}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </Svg>
  ),
  more: (
    <Svg className="w-6 h-6" strokeWidth={2}>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </Svg>
  ),
};

// ─── Layout bits ──────────────────────────────────────────────
export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
      {children}
    </div>
  );
}

/** White rounded card used throughout the views. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`bg-white rounded-[24px] p-5 mb-3 shadow-[0_2px_12px_rgba(81,43,43,0.04)] border border-pc-line ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * Bottom sheet (the app's modal pattern). Renders nothing while closed, so state inside
 * `children` is fresh on every open.
 */
export function Sheet({
  open = true,
  onClose,
  title,
  subtitle,
  children,
  z = 50,
}: {
  open?: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  z?: number;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 flex items-end justify-center pc-overlay"
      style={{ background: "rgba(45,23,23,0.55)", zIndex: z }}
      onClick={onClose}
    >
      <div
        className="pc-sheet bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          maxHeight: "92dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />
        {title && <div className="font-extrabold text-[22px] tracking-tight mb-1">{title}</div>}
        {subtitle && <div className="text-[13px] text-pc-muted mb-5">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

/** A row in the "Mer" list. Other PRs mount their own `<MoreRow>` into the More slots. */
export function MoreRow({
  icon,
  title,
  subtitle,
  onClick,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pc-press w-full flex items-center gap-3 px-4 py-3.5 text-left border-t border-pc-line first:border-t-0"
    >
      <span className="w-9 h-9 shrink-0 rounded-xl bg-pc-apricot flex items-center justify-center text-[17px] text-pc-orange-deep">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-[14px] text-pc-ink leading-tight">{title}</span>
        {subtitle && (
          <span className="block text-[12px] text-pc-muted font-medium mt-0.5 truncate">
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
      <span className="text-pc-muted shrink-0">
        <IconChevron />
      </span>
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pc-press w-full py-4 rounded-[18px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pc-press w-full py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// ─── Stats ────────────────────────────────────────────────────
export function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-pc-apricot rounded-2xl px-4 py-3 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1">
        {label}
      </div>
      <div
        className={`text-[22px] font-extrabold tabular-nums tracking-tight ${accent ? "text-pc-orange-deep" : "text-pc-ink"}`}
      >
        {value}
      </div>
    </div>
  );
}

export function FlexSubStat({ label, minutes }: { label: string; minutes: number }) {
  const color = minutes > 0 ? "text-green-600" : minutes < 0 ? "text-red-500" : "text-pc-muted";
  const sign = minutes >= 0 ? "+" : "−";
  return (
    <div className="bg-pc-apricot rounded-2xl px-2.5 py-3 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-1 truncate">
        {label}
      </div>
      <div
        className={`text-[14px] font-extrabold tabular-nums tracking-tight whitespace-nowrap ${color}`}
      >
        {sign}
        {fmtMin(Math.abs(minutes))}
      </div>
    </div>
  );
}

// ─── Session row ──────────────────────────────────────────────
export function SessionRow({
  session,
  index,
  onEdit,
  onDelete,
  readOnly,
}: {
  session: Session;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  /** The day is locked: show the pass, hide edit/delete. */
  readOnly?: boolean;
}) {
  const dur = fmtDur(((session.checkOut ?? Date.now()) - session.checkIn) / 60000);
  const timeRange = session.checkOut
    ? `${fmtTime(session.checkIn)} → ${fmtTime(session.checkOut)}`
    : `${fmtTime(session.checkIn)} → pågår`;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold text-pc-ink">Pass {index + 1}</span>
          {session.manual && <span className="text-[11px] text-pc-muted">✏️</span>}
          {session.source && (
            <span className="text-[11px] text-pc-muted" title={SOURCE_META[session.source].label}>
              {SOURCE_META[session.source].emoji}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[13px] text-pc-muted tabular-nums font-medium">{timeRange}</span>
          {session.checkOut && (
            <span className="text-[12px] text-pc-orange-deep font-semibold tabular-nums">
              {dur}
            </span>
          )}
        </div>
        {session.note && (
          <div className="text-[11px] text-pc-muted font-medium mt-0.5 leading-snug">
            {session.note}
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-1 shrink-0">
          {session.checkOut && (
            <button
              onClick={onEdit}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-pc-muted hover:text-pc-orange hover:bg-pc-peach transition-colors"
              aria-label="Redigera pass"
            >
              <IconEdit />
            </button>
          )}
          <button
            onClick={onDelete}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-pc-muted hover:text-red-500 hover:bg-red-50 transition-colors"
            aria-label="Ta bort pass"
          >
            <IconTrash />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Month picker ─────────────────────────────────────────────
// Two quick choices (this/last month, labelled with the month names) plus
// "Annan…" which reveals a native <select> with the last 24 months.
export function MonthPicker({
  value,
  onChange,
}: {
  value: { year: number; month: number };
  onChange: (m: { year: number; month: number }) => void;
}) {
  const nowD = new Date();
  const cur = { year: nowD.getFullYear(), month: nowD.getMonth() };
  const prevD = new Date(cur.year, cur.month - 1, 1);
  const prev = { year: prevD.getFullYear(), month: prevD.getMonth() };
  const isCur = value.year === cur.year && value.month === cur.month;
  const isPrev = value.year === prev.year && value.month === prev.month;
  const [showOther, setShowOther] = useState(!isCur && !isPrev);

  const monthLabel = (y: number, m: number, opts: Intl.DateTimeFormatOptions) => {
    const raw = new Date(y, m).toLocaleDateString("sv-SE", opts);
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const pill = (active: boolean) =>
    `pc-press px-2 py-2.5 rounded-[14px] text-[13px] font-bold border transition-colors ${
      active
        ? "bg-pc-orange text-white border-pc-orange shadow-[0_4px_12px_-4px_rgba(255,95,0,0.45)]"
        : "bg-white border-pc-line text-pc-ink"
    }`;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={pill(!showOther && isCur)}
          onClick={() => {
            setShowOther(false);
            onChange(cur);
          }}
        >
          {monthLabel(cur.year, cur.month, { month: "long" })}
        </button>
        <button
          type="button"
          className={pill(!showOther && isPrev)}
          onClick={() => {
            setShowOther(false);
            onChange(prev);
          }}
        >
          {monthLabel(prev.year, prev.month, { month: "long" })}
        </button>
        <button type="button" className={pill(showOther)} onClick={() => setShowOther(true)}>
          {showOther && !isCur && !isPrev
            ? monthLabel(value.year, value.month, { month: "short", year: "2-digit" })
            : "Annan…"}
        </button>
      </div>
      {showOther && (
        <select
          value={`${value.year}-${value.month}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            onChange({ year: y, month: m });
          }}
          className="pc-input"
          style={{ marginBottom: 0, marginTop: 12 }}
        >
          {Array.from({ length: 24 }, (_, i) => {
            const d = new Date(cur.year, cur.month - i, 1);
            return (
              <option key={i} value={`${d.getFullYear()}-${d.getMonth()}`}>
                {monthLabel(d.getFullYear(), d.getMonth(), { month: "long", year: "numeric" })}
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
}

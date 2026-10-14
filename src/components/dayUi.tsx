// Day-related presentational pieces: the status chip and the schedule nudge banner.
import type { DayStatus } from "../lib/days";

const STATUS_STYLE: Record<DayStatus, { label: string; cls: string }> = {
  reported: { label: "Registrerad", cls: "bg-green-50 text-green-700" },
  partial: { label: "Delvis frånvaro", cls: "bg-blue-50 text-blue-700" },
  absent: { label: "Frånvaro", cls: "bg-blue-50 text-blue-700" },
  unconfirmed: { label: "Ej bekräftad", cls: "bg-gray-100 text-gray-600" },
  missing: { label: "Saknas", cls: "bg-red-50 text-red-600" },
  ongoing: { label: "Pågår", cls: "bg-pc-orange/10 text-pc-orange-deep" },
  off: { label: "Ledig", cls: "bg-pc-bg text-pc-muted" },
};

export function StatusChip({ status, label }: { status: DayStatus; label?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-block shrink-0 px-2.5 py-1 rounded-full text-[11px] font-extrabold ${s.cls}`}
    >
      {label ?? s.label}
    </span>
  );
}

// Inline nudge card on the Today view, driven by today's schedule.
export function ScheduleBanner({
  emoji,
  text,
  primary,
  secondary,
  onDismiss,
}: {
  emoji: string;
  text: string;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  return (
    <div className="mt-4 bg-white border border-pc-orange/30 rounded-[20px] p-4 pc-pop shadow-[0_4px_16px_rgba(255,95,0,0.12)]">
      <div className="flex items-start gap-3">
        <span className="text-[20px] leading-none mt-0.5">{emoji}</span>
        <div className="flex-1 text-[13px] font-semibold text-pc-ink leading-snug">{text}</div>
        <button
          onClick={onDismiss}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-pc-muted hover:bg-pc-peach"
          aria-label="Stäng"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className={`grid gap-2 mt-3 ${secondary ? "grid-cols-2" : "grid-cols-1"}`}>
        <button
          onClick={primary.onClick}
          className="pc-press py-2.5 rounded-[14px] text-white font-bold text-[13px]"
          style={{ background: "linear-gradient(135deg, #ff5f00 0%, #e04d00 100%)" }}
        >
          {primary.label}
        </button>
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="pc-press py-2.5 rounded-[14px] bg-pc-bg border border-pc-line font-bold text-[13px] text-pc-ink"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
}

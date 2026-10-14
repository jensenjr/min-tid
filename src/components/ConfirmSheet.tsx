import { Sheet } from "./ui";

/** A small "are you sure" bottom sheet (confirm / unlock a month). */
export default function ConfirmSheet({
  open,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} onClose={onCancel} title={title} z={55}>
      <div className="text-[14px] text-pc-muted leading-relaxed mb-6">{text}</div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onCancel}
          className="pc-press py-4 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[15px] text-pc-ink"
        >
          Avbryt
        </button>
        <button
          onClick={onConfirm}
          className={`pc-press py-4 rounded-[16px] text-white font-bold text-[15px] ${danger ? "bg-red-500" : "bg-pc-orange shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)]"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

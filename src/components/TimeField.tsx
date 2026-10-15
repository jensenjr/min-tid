import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isCompleteTyped, parseTyped, snapValue } from "../lib/timeField";

// Time input used everywhere instead of a bare <input type="time">:
//  • a text field you type into freely ("1645", "16:45", "16.45", "945" → 09:45). Tapping it
//    clears the shown time so you can type straight away; leaving it untouched brings the old
//    time back. Typed times are taken exactly as written.
//  • a clock button that opens the device's own time picker (iOS/Android wheel, desktop
//    picker), stepped to 5 minutes. The real <input type="time"> sits invisibly on top of the
//    icon, so a tap on a phone hits it directly; on desktop we call showPicker().

function IconClock() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M12 7v5l3.2 2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TimeField({
  value,
  onChange,
  label = "Tid",
  placeholder = "tt:mm",
  clearable = false,
  disabled = false,
  compact = false,
  className = "pc-input",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Slut". */
  label?: string;
  placeholder?: string;
  /** An emptied field means "no time" (e.g. an ongoing session's end). */
  clearable?: boolean;
  disabled?: boolean;
  /** Small variant for the schedule rows. */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const typedRef = useRef(false);
  const nativeRef = useRef<HTMLInputElement>(null);

  // Follow outside changes (clock picker, other fields) while the user isn't typing.
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  const commitTyped = () => {
    setFocused(false);
    if (!typedRef.current) {
      // Tapped in and out without typing: keep the old time.
      setText(value);
      return;
    }
    const parsed = parseTyped(text);
    if (parsed === null || (parsed === "" && !clearable)) {
      setInvalid(parsed === null);
      setText(value);
      return;
    }
    setInvalid(false);
    setText(parsed);
    if (parsed !== value) onChange(parsed);
  };

  const { marginBottom, ...fieldStyle } = style ?? {};
  const size = compact ? 34 : 52;

  return (
    <div
      className="flex items-stretch gap-2"
      style={{ marginBottom: marginBottom ?? (compact ? 0 : 16) }}
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={text}
        placeholder={focused && value ? value : placeholder}
        maxLength={5}
        onFocus={() => {
          setFocused(true);
          setInvalid(false);
          typedRef.current = false;
          setText("");
        }}
        onChange={(e) => {
          typedRef.current = true;
          const next = e.target.value.replace(/[^\d:., ]/g, "");
          setText(next);
          // Let the rest of the form follow along as soon as the time is complete.
          if (isCompleteTyped(next)) {
            const parsed = parseTyped(next);
            if (parsed) onChange(parsed);
          }
        }}
        onBlur={commitTyped}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            typedRef.current = false;
            e.currentTarget.blur();
          }
        }}
        className={`${className} tabular-nums`}
        style={{
          marginBottom: 0,
          flex: 1,
          minWidth: 0,
          ...(invalid ? { borderColor: "#dc2626" } : null),
          ...fieldStyle,
        }}
      />
      <span
        className="relative shrink-0 flex items-center justify-center rounded-[14px] bg-pc-apricot text-pc-orange-deep"
        style={{ width: size, minHeight: size, opacity: disabled ? 0.4 : 1 }}
      >
        <IconClock />
        <input
          ref={nativeRef}
          type="time"
          step={300}
          tabIndex={-1}
          aria-label={`${label} – välj med klockan`}
          disabled={disabled}
          value={value}
          onClick={() => {
            try {
              nativeRef.current?.showPicker?.();
            } catch {
              // Not supported here — the tap on the input itself opens the picker on phones.
            }
          }}
          onChange={(e) => {
            const snapped = snapValue(e.target.value);
            if (snapped) {
              setInvalid(false);
              onChange(snapped);
            } else if (e.target.value === "" && clearable) {
              onChange("");
            }
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          // 16px keeps iOS from zooming the page when the picker opens.
          style={{ fontSize: 16 }}
        />
      </span>
    </div>
  );
}

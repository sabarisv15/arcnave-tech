/**
 * Six code boxes over one real input (board `S3-Code` rules "One real input" and "Grouped 3 + 3").
 *
 * The boxes are drawn, not typed into: they are aria-hidden and a single transparent text field
 * sits over them (inputmode numeric, autocomplete one-time-code), so paste and autofill from Mail
 * work and a screen reader hears one field. Shared by the e-mail code and the 2-step app code.
 *
 * UI only; backend flow not built yet (N-72, Phase 5).
 */
import { useRef } from "react";

export const CODE_LENGTH = 6;

/** idle: next box is highlighted; plain: nothing highlighted; dim/err/ok/dis: board box states. */
export type CodeBoxTone = "idle" | "plain" | "dim" | "err" | "ok" | "dis";

export const digitsOnly = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, CODE_LENGTH);

export function CodeBoxes({
  id,
  value,
  onChange,
  tone = "idle",
  disabled = false,
  describedBy,
  label = "6-digit code",
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  tone?: CodeBoxTone;
  disabled?: boolean;
  describedBy?: string;
  label?: string;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = tone === "idle" ? Math.min(value.length, CODE_LENGTH - 1) : -1;
  const cls = (i: number) => {
    const kind =
      tone === "idle" || tone === "plain" ? (i === active ? "on" : "") : tone;
    return [
      "sx-cbx",
      i === 3 ? "sx-cbx--gap" : "",
      kind ? `sx-cbx--${kind}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  };
  return (
    <div className="sx-boxes" onClick={() => input.current?.focus()}>
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <span key={i} className={cls(i)} aria-hidden="true">
          {value[i] ?? ""}
        </span>
      ))}
      <input
        id={id}
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        aria-label={label}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(digitsOnly(event.target.value))}
      />
    </div>
  );
}

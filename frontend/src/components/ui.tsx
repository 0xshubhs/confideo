import { useState, type ReactNode } from "react";
import { EXPLORER } from "../config";
import { shortAddr } from "../lib/format";

export function Card({ title, subtitle, children, accent }: { title?: string; subtitle?: string; children: ReactNode; accent?: boolean }) {
  return (
    <section className={"card" + (accent ? " card-accent" : "")}>
      {title && <h3 className="card-title">{title}</h3>}
      {subtitle && <p className="card-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

/** A button that owns its OWN pending state — disables immediately, shows an inline spinner, releases in finally. */
export function ActionButton({
  onClick,
  children,
  pendingLabel,
  variant = "primary",
  disabled,
}: {
  onClick: () => Promise<void> | void;
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={busy || disabled}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <span className="spinner" aria-hidden />}
      {busy && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function AddressTag({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="addr addr-empty">not set</span>;
  return (
    <span className="addr">
      {label && <span className="addr-label">{label}</span>}
      <code>{shortAddr(value)}</code>
      <button
        className="addr-btn"
        title="Copy address"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
      <a className="addr-btn" href={`${EXPLORER}/address/${value}`} target="_blank" rel="noreferrer" title="View on Etherscan">
        ↗
      </a>
    </span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="txlink" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
      tx {shortAddr(hash)} ↗
    </a>
  );
}

export function Banner({ kind, children, onClose }: { kind: "error" | "info" | "success"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`banner banner-${kind}`}>
      <span>{children}</span>
      {onClose && (
        <button className="banner-close" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner spinner-dark" aria-label="loading" />;
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "warn" | "muted" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** A hidden encrypted value with a one-click decrypt. `load` resolves to the display string. */
export function Reveal({ load, hiddenLabel, render }: { load: () => Promise<string>; hiddenLabel?: string; render?: (v: string) => ReactNode }) {
  const [val, setVal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (val !== null) return <span className="value">{render ? render(val) : val}</span>;
  return (
    <span className="inline-actions">
      <span className="value value-hidden">{hiddenLabel ?? "••••••"}</span>
      <ActionButton
        variant="ghost"
        pendingLabel="Decrypting…"
        onClick={async () => {
          setErr(null);
          try {
            setVal(await load());
          } catch (e) {
            const m = (e as { shortMessage?: string; message?: string });
            setErr(m?.shortMessage || m?.message || "Not authorized to decrypt.");
          }
        }}
      >
        Decrypt
      </ActionButton>
      {err && <span className="muted" style={{ color: "var(--danger)" }}>{err}</span>}
    </span>
  );
}

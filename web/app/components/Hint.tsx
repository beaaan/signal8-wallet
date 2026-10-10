"use client";

import { useId, useState } from "react";

/**
 * A label that folds out a one-line explanation on click, tap or Enter, instead of a `title` hover that touch
 * and keyboard users cannot reach. The text stays hidden until asked for, so the page stays quiet.
 */
export function Hint({ text, className, children }: { text?: string | null; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text) return <span className={className}>{children}</span>;
  return (
    <>
      <button type="button" className={`hint${className ? ` ${className}` : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {children}
      </button>
      <span id={id} className="hint-text" hidden={!open}>
        {text}
      </span>
    </>
  );
}

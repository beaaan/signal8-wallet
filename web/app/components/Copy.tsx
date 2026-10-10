"use client";

import { useState } from "react";
import { shortTx } from "@/lib/format";
import { Icon } from "./Icons";

/** Clipboard API where allowed (https, localhost); a hidden textarea otherwise (phones on the LAN over http). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copy", doneLabel = "Copied" }: { text: string; label?: string; doneLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={done ? doneLabel : label}
      title={done ? doneLabel : label}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      <Icon name={done ? "check" : "copy"} size={13} />
    </button>
  );
}

/** A short hash (0x1234…abcd) with a copy button, for chains without a block explorer. */
export function ShortHash({ hash }: { hash: string }) {
  return (
    <span className="short-hash">
      <span className="mono">{shortTx(hash)}</span>
      <CopyButton text={hash} label="Copy transaction hash" />
    </span>
  );
}

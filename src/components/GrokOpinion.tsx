"use client";

import { useState } from "react";

type Props = {
  reportJson: unknown;
};

/**
 * Optional Phase 5.3 — Grok voice second opinion.
 * Only activates when NEXT_PUBLIC_XAI_VOICE=1 and user has XAI_API_KEY server-side
 * (client opens a note; full Realtime WS needs a short-lived token endpoint).
 */
export function GrokOpinion({ reportJson }: Props) {
  const [open, setOpen] = useState(false);
  const enabled =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_XAI_VOICE === "1";

  if (!enabled) return null;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-slate-800 hover:text-emerald-700"
      >
        Grok second opinion {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-slate-600">
          <p>
            Optional xAI voice layer. Set{" "}
            <code className="text-[10px]">XAI_API_KEY</code> and{" "}
            <code className="text-[10px]">NEXT_PUBLIC_XAI_VOICE=1</code>. Connect
            to{" "}
            <code className="text-[10px]">
              wss://api.x.ai/v1/realtime?model=grok-voice-latest
            </code>{" "}
            with the report as session context (~$0.05/min).
          </p>
          <pre className="max-h-24 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
            {JSON.stringify(reportJson, null, 0).slice(0, 400)}…
          </pre>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { TranscriptLine } from "@/lib/ui/types";

type Props = {
  lines: TranscriptLine[];
  /** Visible rows at once (~3 WhatsApp-style bubbles) */
  visibleCount?: number;
  highlightTs?: number | null;
  onLineClick?: (ts: number) => void;
};

/**
 * Full conversation scroll; ~3 bubbles visible.
 * Agent/negotiator = left (incoming), vendor = right (outgoing WhatsApp style).
 * New messages animate in like WhatsApp send.
 */
export function TranscriptTicker({
  lines,
  visibleCount = 3,
  highlightTs = null,
  onLineClick,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevLen = useRef(0);

  // Approximate bubble height including gap (~72px) × 3
  const viewportMaxH = visibleCount * 76;

  useEffect(() => {
    if (lines.length > prevLen.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevLen.current = lines.length;
  }, [lines.length, lines]);

  if (!lines.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-[#e5ddd5]/30 px-3"
        style={{ minHeight: viewportMaxH }}
      >
        <p className="text-xs text-slate-400 italic">Waiting for conversation…</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-[#e5ddd5]/40">
      <div
        ref={scrollerRef}
        className="wa-chat-scroll overflow-y-auto overscroll-contain px-2.5 py-2"
        style={{ maxHeight: viewportMaxH, minHeight: Math.min(viewportMaxH, 120) }}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <ul className="flex flex-col gap-2">
          {lines.map((line, idx) => {
            const isAgent =
              line.speaker === "negotiator" || line.speaker === "system";
            const isVendor = line.speaker === "vendor";
            const active =
              highlightTs != null && Math.abs(line.ts - highlightTs) < 0.5;
            // Animate messages that just entered (last visible batch)
            const isNew = idx >= Math.max(0, lines.length - 3);

            return (
              <li
                key={line.id}
                id={`ts-${line.ts}`}
                className={`flex w-full ${
                  isVendor ? "justify-end" : "justify-start"
                } ${isNew ? "wa-msg-in" : ""}`}
                onClick={() => onLineClick?.(line.ts)}
              >
                <div
                  className={`relative max-w-[88%] px-2.5 py-1.5 text-xs leading-snug shadow-sm ${
                    isVendor
                      ? "wa-bubble-out bg-[#d9fdd3] text-slate-900"
                      : isAgent
                        ? "wa-bubble-in bg-white text-slate-800"
                        : "rounded-lg bg-slate-100 text-slate-600"
                  } ${
                    active ? "ring-2 ring-emerald-400 ring-offset-1" : ""
                  } ${onLineClick ? "cursor-pointer" : ""}`}
                >
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-60">
                    {isVendor
                      ? "Provider"
                      : line.speaker === "system"
                        ? "System"
                        : "Agent"}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{line.text}</p>
                  <p
                    className={`mt-0.5 text-right text-[9px] tabular-nums opacity-50 ${
                      isVendor ? "text-slate-600" : "text-slate-500"
                    }`}
                  >
                    {formatTs(line.ts)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <div ref={bottomRef} />
      </div>
      {lines.length > visibleCount && (
        <p className="border-t border-slate-200/60 bg-white/50 px-2 py-1 text-center text-[10px] text-slate-400">
          Scroll for full conversation · {lines.length} messages
        </p>
      )}
    </div>
  );
}

function formatTs(ts: number): string {
  // ts may be seconds into call or ms residue — show compact
  if (ts > 10_000) {
    const s = Math.floor(ts / 1000) % 3600;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }
  const m = Math.floor(ts / 60);
  const r = Math.floor(ts % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

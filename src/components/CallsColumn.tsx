"use client";

import { useRef, useState } from "react";
import type { SessionCard, VerticalConfig } from "@/lib/ui/types";
import { uiCopy } from "@/lib/ui/types";
import { PriceDisplay } from "./PriceDisplay";
import { StatusChip } from "./StatusChip";
import { TranscriptTicker } from "./TranscriptTicker";

type Props = {
  vertical: VerticalConfig;
  sessions: SessionCard[];
  highlight?: { vendor_id: string; ts: number } | null;
  onHighlightClear?: () => void;
};

export function CallsColumn({
  vertical,
  sessions,
  highlight,
  onHighlightClear,
}: Props) {
  const copy = uiCopy(vertical);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
          Calls
        </p>
        <h2 className="text-lg font-semibold text-slate-900">
          {copy.calls_column_title}
        </h2>
        <p className="text-sm text-slate-500">
          3 simultaneous negotiations · live transcript
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {sessions.map((s) => (
          <CallCard
            key={s.vendor_id}
            session={s}
            highlightTs={
              highlight?.vendor_id === s.vendor_id ? highlight.ts : null
            }
            onHeard={onHighlightClear}
          />
        ))}
      </div>
    </section>
  );
}

function CallCard({
  session,
  highlightTs,
  onHeard,
}: {
  session: SessionCard;
  highlightTs: number | null;
  onHeard?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const hasAudio = Boolean(session.audio_url);

  const toggleAudio = () => {
    if (!session.audio_url || !audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      void audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900">
            {session.vendor_name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusChip status={session.status} />
            {session.competing_bid_used && (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">
                Competing bid used
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={!hasAudio}
          onClick={toggleAudio}
          title={hasAudio ? "Toggle call audio" : "Audio unavailable"}
          className="shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:enabled:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? "Pause" : "Audio"}
        </button>
        {session.audio_url && (
          <audio
            ref={audioRef}
            src={session.audio_url}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
        )}
      </div>

      <div className="mt-3">
        <PriceDisplay price={session.current_price} />
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Messages · agent left · provider right · scroll all
        </p>
        <TranscriptTicker
          lines={session.transcript}
          visibleCount={3}
          highlightTs={highlightTs}
          onLineClick={() => onHeard?.()}
        />
      </div>
    </article>
  );
}

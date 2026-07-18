"use client";

import { useEffect, useState } from "react";

type Row = {
  tactic: string;
  outcome_delta: number;
  sample_count: number;
};

type Props = {
  vertical: string;
};

/** Playbook leaderboard — Phase 3 learning surface */
export function LearningPanel({ vertical }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [sentences, setSentences] = useState<string[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/learning?vertical=${encodeURIComponent(vertical)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          rows?: Row[];
          sentences?: string[];
          version?: number;
        };
        if (cancelled) return;
        setRows(data.rows || []);
        setSentences(data.sentences || []);
        setVersion(data.version || 0);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vertical]);

  if (!rows.length && !sentences.length) return null;

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-800">
          Learning
        </p>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
          playbook v{version || 1}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {rows.slice(0, 5).map((r) => (
          <li
            key={r.tactic}
            className="flex items-center justify-between gap-2 text-xs text-slate-700"
          >
            <span className="font-medium">{r.tactic.replace(/_/g, " ")}</span>
            <span className="tabular-nums text-violet-800">
              {r.outcome_delta.toFixed(0)}% · n={r.sample_count}
            </span>
          </li>
        ))}
      </ul>
      {sentences[0] && (
        <p className="mt-2 text-[11px] leading-snug text-slate-600">
          {sentences[0]}
        </p>
      )}
    </div>
  );
}

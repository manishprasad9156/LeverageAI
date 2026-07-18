"use client";

import { useState } from "react";
import type {
  BenchmarkEntry,
  RankedDeal,
  SessionCard,
  VerticalConfig,
} from "@/lib/ui/types";
import { redFlagThresholdPct, uiCopy } from "@/lib/ui/types";
import { GrokOpinion } from "./GrokOpinion";

type Props = {
  vertical: VerticalConfig;
  phase: string;
  ranked: RankedDeal[];
  sessions: SessionCard[];
  onListen: (vendor_id: string, ts: number) => void;
  replay?: boolean;
  jobSpec?: Record<string, unknown> | null;
};

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function redBanner(vertical: VerticalConfig, pct: number): string {
  if (vertical.red_flag.banner_template) {
    return vertical.red_flag.banner_template.replace("{pct}", String(pct));
  }
  return `${pct}% below market — bait-price risk`;
}

function formatTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function DealColumn({
  vertical,
  phase,
  ranked,
  sessions,
  onListen,
  replay,
  jobSpec,
}: Props) {
  const ready = phase === "complete" && ranked.length > 0;
  const copy = uiCopy(vertical);
  const benchKey =
    vertical.red_flag.benchmark_key || vertical.default_job_type || "";
  const bench = benchKey ? vertical.benchmarks[benchKey] : undefined;

  const exportReport = () => {
    const html = buildPrintableReport({
      vertical,
      ranked,
      sessions,
      jobSpec,
      bench,
    });
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            Deal
          </p>
          <h2 className="text-lg font-semibold text-slate-900">
            {copy.deal_column_title}
          </h2>
          <p className="text-sm text-slate-500">
            Ranked quotes · red flags (≥{redFlagThresholdPct(vertical)}% under
            mid)
          </p>
          {bench?.source && (
            <p
              className="mt-1 text-[10px] text-slate-400"
              title={bench.source}
            >
              Fair band{" "}
              {bench.fair_low != null && bench.fair_high != null
                ? `$${bench.fair_low}–$${bench.fair_high}`
                : ""}{" "}
              · {bench.source.slice(0, 60)}
              {bench.source.length > 60 ? "…" : ""}
            </p>
          )}
        </div>
        {ready && (
          <button
            type="button"
            onClick={exportReport}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Export report
          </button>
        )}
      </header>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-400">
            {phase === "calling"
              ? "Ranking appears when all three calls finish."
              : "Confirm your job to start calls."}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto">
          {ranked.map((r) => (
            <DealCard
              key={r.session.vendor_id + r.rank}
              deal={r}
              vertical={vertical}
              onListen={onListen}
              replay={replay}
              fullSession={
                sessions.find((s) => s.vendor_id === r.session.vendor_id) ||
                r.session
              }
            />
          ))}
          <GrokOpinion
            reportJson={{
              vertical: vertical.id,
              ranked: ranked.map((r) => ({
                vendor: r.session.vendor_name,
                total: r.session.current_price,
                red_flag: r.red_flag,
                why: r.why,
              })),
            }}
          />
        </div>
      )}
    </section>
  );
}

function buildPrintableReport(input: {
  vertical: VerticalConfig;
  ranked: RankedDeal[];
  sessions: SessionCard[];
  jobSpec?: Record<string, unknown> | null;
  bench?: BenchmarkEntry;
}): string {
  const rows = input.ranked
    .map((r) => {
      const s = r.session;
      return `<tr>
        <td>${r.rank}</td>
        <td>${s.vendor_name}</td>
        <td>${s.current_price != null ? formatUsd(s.current_price) : s.outcome}</td>
        <td>${r.red_flag ? "BAIT RISK" : "—"}</td>
        <td>${r.why || ""}</td>
      </tr>`;
    })
    .join("");
  return `<!doctype html><html><head><title>LeverageAI Report</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
    h1{font-size:20px} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #e2e8f0;padding:8px;text-align:left;font-size:13px}
    th{background:#f8fafc} .note{font-size:12px;color:#64748b;margin-top:12px}
    @media print{button{display:none}}
  </style></head><body>
  <h1>LeverageAI — quote report</h1>
  <p>Vertical: ${input.vertical.displayName || input.vertical.id}</p>
  <p>Job: ${JSON.stringify(input.jobSpec || {})}</p>
  ${
    input.bench?.source
      ? `<p class="note">Benchmark: ${input.bench.source}</p>`
      : ""
  }
  <table><thead><tr><th>#</th><th>Vendor</th><th>Total</th><th>Flags</th><th>Why</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p class="note">LeverageAI never promises the lowest price. Red-flagged quotes ≥30% below fair mid are warnings, not winners.</p>
  </body></html>`;
}

function DealCard({
  deal,
  vertical,
  onListen,
  fullSession,
  replay,
}: {
  deal: RankedDeal;
  vertical: VerticalConfig;
  onListen: (vendor_id: string, ts: number) => void;
  fullSession: SessionCard;
  replay?: boolean;
}) {
  const [open, setOpen] = useState(deal.recommended || deal.red_flag);
  const s = deal.session;
  const price = s.current_price;
  const chain = deal.leverage_chain || [];

  const downloadTranscript = () => {
    const payload = {
      vendor: s.vendor_name,
      vendor_id: s.vendor_id,
      outcome: s.outcome,
      price: s.current_price,
      line_items: s.line_items,
      transcript: fullSession.transcript,
      callback_at: s.callback_at,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${s.vendor_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAudio = () => {
    if (!s.audio_url) return;
    const a = document.createElement("a");
    a.href = s.audio_url;
    a.download = `call-${s.vendor_id}.mp3`;
    a.target = "_blank";
    a.click();
  };

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        deal.recommended
          ? "border-emerald-300 ring-1 ring-emerald-200"
          : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">
              #{deal.rank}
            </span>
            <h3 className="font-semibold text-slate-900">{s.vendor_name}</h3>
            {deal.recommended && (
              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                Recommended
              </span>
            )}
          </div>
          {price != null ? (
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatUsd(price)}
            </p>
          ) : (
            <p className="mt-1 text-sm font-medium text-slate-500">
              {s.outcome === "documented_decline"
                ? "Documented decline"
                : s.outcome === "callback_commitment"
                  ? "Callback only"
                  : "No price"}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          {open ? "Hide" : "Details"}
        </button>
      </div>

      {deal.red_flag && deal.red_flag_pct != null && (
        <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 ring-1 ring-rose-200">
          {redBanner(vertical, deal.red_flag_pct)}
        </div>
      )}

      {deal.why && (
        <p className="mt-2 text-sm text-slate-600">{deal.why}</p>
      )}

      {s.callback_at && (
        <p className="mt-1 text-xs text-slate-500">
          Callback: <span className="font-medium">{s.callback_at}</span>
        </p>
      )}

      {open && s.line_items?.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {s.line_items.map((li, i) => (
            <li
              key={`${li.label}-${i}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="text-slate-700">{li.label}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums font-medium text-slate-900">
                  {formatUsd(li.amount)}
                </span>
                {li.evidence_ts != null && (
                  <button
                    type="button"
                    onClick={() => onListen(s.vendor_id, li.evidence_ts!)}
                    className="text-[11px] font-medium text-emerald-700 hover:underline"
                  >
                    Listen
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && chain.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
            Leverage chain
          </p>
          <ol className="mt-2 space-y-1.5">
            {chain.map((step, i) => (
              <li key={i} className="text-xs text-slate-700">
                <span className="font-mono text-emerald-700">
                  [t={formatTs(step.t_ms)}]
                </span>{" "}
                {step.label}
              </li>
            ))}
          </ol>
        </div>
      )}

      {open && (
        <p className="mt-2 text-xs text-slate-500">
          {replay || !s.audio_url
            ? "Recording available in live mode — golden transcript shown."
            : "Live recording attached."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadTranscript}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Download transcript
        </button>
        {s.audio_url ? (
          <audio controls src={s.audio_url} className="h-8 max-w-[200px]" />
        ) : (
          <button
            type="button"
            onClick={downloadAudio}
            disabled
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-400"
          >
            Play audio (live only)
          </button>
        )}
      </div>
    </article>
  );
}

"use client";

import { useMemo } from "react";
import { GOLDEN_SEQUENCE, runGoldenMachineSequence } from "@/lib/orchestrator/machine";

const NODES: { id: string; label: string; detail: string }[] = [
  {
    id: "intake",
    label: "Intake",
    detail: "ElevenLabs intake agent · voice/PDF · JobSpec",
  },
  {
    id: "specConfirm",
    label: "Spec confirm",
    detail: "User freezes job_spec · immutable snapshot",
  },
  {
    id: "discovery",
    label: "Discovery",
    detail: "Google Places searchText + Place Details (cached)",
  },
  {
    id: "providerRank",
    label: "Provider rank",
    detail: "ProviderScore = 30R+20V+10F+10O+30N",
  },
  {
    id: "negotiating",
    label: "Negotiating",
    detail: "3 sequential bridges · tools · honesty law",
  },
  {
    id: "reportReady",
    label: "Report",
    detail: "Ranked quotes · red flags · leverage chain",
  },
  {
    id: "exported",
    label: "Exported",
    detail: "Printable report · recordings",
  },
];

export default function ArchitecturePage() {
  const golden = useMemo(() => runGoldenMachineSequence(), []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <a href="/" className="text-sm text-emerald-700 hover:underline">
          ← LeverageAI
        </a>
        <h1 className="mt-1 text-xl font-semibold">Architecture</h1>
        <p className="text-sm text-slate-500">
          XState v5 orchestrator · ElevenLabs voice · Neon · Places · ranking
        </p>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 p-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Job state machine
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {NODES.map((n, i) => (
              <div key={n.id} className="flex items-center gap-2">
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    golden.sequence.includes(n.id as never)
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <p className="font-semibold">{n.label}</p>
                  <p className="text-[11px] text-slate-500">{n.detail}</p>
                </div>
                {i < NODES.length - 1 && (
                  <span className="text-slate-300">→</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Golden machine replay:{" "}
            <span
              className={
                golden.pass ? "font-semibold text-emerald-700" : "text-rose-600"
              }
            >
              {golden.pass ? "PASS" : "FAIL"}
            </span>{" "}
            · sequence: {golden.sequence.join(" → ")}
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            System diagram
          </h2>
          <pre className="mt-3 overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-relaxed text-emerald-100">
{`Orchestrator (XState v5)
  ├─ Intake ── ElevenLabs intake agent ── submit_spec webhook
  ├─ Discovery ── Google Places (search + details, 7d cache)
  ├─ ProviderScore ranking (Bayesian R + V + F + O + N)
  ├─ Negotiating ── 5 ElevenLabs agents (WS bridge, sequential)
  │     tools: get_competing_bids · log_quote · lookup_benchmark · close_session
  ├─ Postgres (Neon): jobs, sessions, quotes, tool_calls, providers,
  │                   negotiation_learnings, orchestration_events, intake_drafts
  ├─ Playbook memory ── injected as {{playbook}} dynamic var
  └─ Report ── ranked deal · leverage chain · export
Optional: Twilio PSTN · Grok voice second opinion · Vercel Blob recordings`}
          </pre>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Expected golden sequence
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {GOLDEN_SEQUENCE.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

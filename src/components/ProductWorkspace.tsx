"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  emptySessions,
  normalizeApiState,
  rankSessions,
} from "@/lib/ui/mockStream";
import type {
  JobSpec,
  JobState,
  TranscriptLine,
  VerticalConfig,
} from "@/lib/ui/types";
import { demoJobSpec } from "@/lib/ui/types";

const MODES = [
  {
    id: "hvac",
    label: "Home AC",
    hint: "Cooling & heating quotes",
    placeholder:
      "Describe the job — e.g. 3-ton AC not cooling in 28202, need replacement this week",
  },
  {
    id: "movers",
    label: "Local move",
    hint: "Moving company quotes",
    placeholder:
      "e.g. 2-bed apartment from Rock Hill to Charlotte, packing help, this weekend",
  },
  {
    id: "medical-imaging",
    label: "Cash MRI",
    hint: "Imaging cash prices",
    placeholder: "e.g. MRI knee without contrast, cash price, ZIP 28202",
  },
  {
    id: "auto-repair",
    label: "Auto repair",
    hint: "Shop repair quotes",
    placeholder: "e.g. 2018 Honda Civic check-engine light, ZIP 28202",
  },
] as const;

type ModeId = (typeof MODES)[number]["id"];

type AgentNature = {
  id: string;
  name: string;
  nature: string;
};

function naturesFromVertical(v: VerticalConfig | null): AgentNature[] {
  if (!v?.vendors?.length) {
    return [
      {
        id: "tough",
        name: "Provider A",
        nature: "The careful one — quality over the lowest price.",
      },
      {
        id: "stonewaller",
        name: "Provider B",
        nature: "The cautious one — may not quote over chat.",
      },
      {
        id: "upseller",
        name: "Provider C",
        nature: "The bargain front — low first number, watch fees.",
      },
    ];
  }
  return v.vendors.map((vendor) => {
    const nature =
      (vendor as { nature?: string }).nature ||
      vendor.role_label ||
      vendor.public_blurb ||
      "Negotiating on your behalf.";
    return {
      id: vendor.id,
      name: vendor.displayName || vendor.name || vendor.id,
      nature: String(nature),
    };
  });
}

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function WaChat({
  name,
  nature,
  lines,
  status,
  total,
}: {
  name: string;
  nature: string;
  lines: TranscriptLine[];
  status: string;
  total: number | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  const live = status === "negotiating" || status === "dialing";
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="flex min-h-[320px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-3 bg-[var(--wa-header)] px-3 py-2.5 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-tight">
            {name}
          </div>
          <div className="truncate text-[11px] text-white/75">{nature}</div>
        </div>
        {live && (
          <span className="flex items-center gap-1.5 text-[11px] text-white/90">
            <span className="pulse-dot bg-emerald-300" />
            Live
          </span>
        )}
      </div>
      <div className="wa-thread flex max-h-[280px] min-h-[220px] flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        {lines.length === 0 && (
          <p className="m-auto text-center text-[12px] text-[var(--ink-muted)]">
            {live ? "Connecting…" : "Waiting to start"}
          </p>
        )}
        {lines.map((line) => {
          const out = line.speaker === "negotiator";
          return (
            <div
              key={line.id}
              className={`flex ${out ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] px-2.5 py-1.5 text-[13px] leading-snug text-[#111] ${
                  out ? "wa-bubble-out" : "wa-bubble-in"
                }`}
              >
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-black/40">
                  {out ? "Your negotiator" : name}
                </div>
                {line.text}
                <div className="mt-0.5 text-right text-[10px] text-black/35">
                  {typeof line.ts === "number" ? `${Math.max(0, line.ts)}s` : ""}
                  {out ? " ✓✓" : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {total != null && (
        <div className="border-t border-[var(--border)] bg-white px-3 py-2 text-[13px] font-medium">
          Latest total: {formatUsd(total)}
        </div>
      )}
    </div>
  );
}

export function ProductWorkspace() {
  const [mode, setMode] = useState<ModeId>("hvac");
  const [modeOpen, setModeOpen] = useState(false);
  const [vertical, setVertical] = useState<VerticalConfig | null>(null);
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<JobState | null>(null);
  const [stage, setStage] = useState<"compose" | "working" | "done">("compose");
  const [talkOpen, setTalkOpen] = useState(false);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [talkUrl, setTalkUrl] = useState<string | null>(null);
  const [liveAvailable, setLiveAvailable] = useState(false);

  const chatsRef = useRef<HTMLDivElement>(null);
  const dealRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const natures = useMemo(() => naturesFromVertical(vertical), [vertical]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/vertical?id=${mode}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load mode");
        const cfg = (await res.json()) as VerticalConfig;
        if (!cancelled) setVertical(cfg);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    fetch("/api/sessions/start", { method: "OPTIONS" }).catch(() => null);
    // lightweight: infer live from public intake agent presence
    setLiveAvailable(Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID));
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!modeRef.current?.contains(e.target as Node)) setModeOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const startPolling = useCallback(
    (jobId: string, cfg: VerticalConfig) => {
      stopPoll();
      const tick = async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}/state`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const raw = await res.json();
          const next = normalizeApiState(raw, cfg);
          if (!next) return;
          setState(next);
          if (next.phase === "complete") {
            stopPoll();
            setBusy(false);
            setStage("done");
            setStatus("Done — your deal is ready");
            requestAnimationFrame(() => {
              dealRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            });
          }
        } catch {
          /* keep polling */
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 800);
    },
    [stopPoll],
  );

  const runPipeline = useCallback(
    async (jobSpec: JobSpec) => {
      if (!vertical) return;
      setBusy(true);
      setError(null);
      setStage("working");
      setStatus("Confirming your job…");

      try {
        const createRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vertical: vertical.id, job_spec: jobSpec }),
        });
        if (!createRes.ok) throw new Error("Could not create job");
        const created = (await createRes.json()) as {
          job?: { id: string };
          id?: string;
          job_id?: string;
        };
        const jobId = created.job?.id || created.job_id || created.id;
        if (!jobId) throw new Error("No job id");

        const confirmRes = await fetch(`/api/jobs/${jobId}/confirm`, {
          method: "PATCH",
        });
        if (!confirmRes.ok) throw new Error("Could not confirm job");

        const zip = String(jobSpec.zip || vertical.demo_defaults?.zip || "28202");
        setStatus("Finding local providers…");
        await fetch("/api/discovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vertical: vertical.id, zip }),
        }).catch(() => null);

        setStatus("Your negotiator is talking to 3 providers…");
        setState({
          job_id: jobId,
          phase: "calling",
          job_spec: jobSpec,
          sessions: emptySessions(vertical),
          ranked: [],
        });

        requestAnimationFrame(() => {
          chatsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });

        // Prefer live multi-agent; server falls back to simulate if needed
        const startRes = await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId }),
        });
        if (!startRes.ok) {
          const err = await startRes.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "Could not start negotiations",
          );
        }
        const body = (await startRes.json()) as {
          live?: boolean;
          simulate?: boolean;
        };
        setStatus(
          body.live
            ? "Live agents negotiating in parallel…"
            : "Negotiating in parallel…",
        );
        startPolling(jobId, vertical);
      } catch (e) {
        setBusy(false);
        setStage("compose");
        setError(e instanceof Error ? e.message : "Something went wrong");
        setStatus(null);
      }
    },
    [vertical, startPolling],
  );

  const onSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!vertical || busy) return;
    setError(null);

    let jobSpec: JobSpec = { ...demoJobSpec(vertical) };

    try {
      setBusy(true);
      setStatus("Reading your request…");

      // Create draft job for PDF path if file attached
      if (file) {
        const createRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vertical: vertical.id,
            job_spec: jobSpec,
          }),
        });
        if (!createRes.ok) throw new Error("Could not prepare upload");
        const created = (await createRes.json()) as {
          job?: { id: string };
          id?: string;
        };
        const jobId = created.job?.id || created.id;
        if (!jobId) throw new Error("No job id");

        const form = new FormData();
        form.append("file", file);
        if (prompt.trim()) form.append("text", prompt.trim());
        const extractRes = await fetch(`/api/jobs/${jobId}/extract-pdf`, {
          method: "POST",
          body: form,
        });
        if (!extractRes.ok) throw new Error("Could not read the document");
        const extracted = (await extractRes.json()) as {
          job?: { job_spec?: JobSpec };
        };
        jobSpec = {
          ...jobSpec,
          ...(extracted.job?.job_spec || {}),
        };
        // confirm + start uses same job — short-circuit into pipeline with known id
        const confirmRes = await fetch(`/api/jobs/${jobId}/confirm`, {
          method: "PATCH",
        });
        if (!confirmRes.ok) throw new Error("Could not confirm job");
        const zip = String(jobSpec.zip || "28202");
        setStage("working");
        setStatus("Finding local providers…");
        await fetch("/api/discovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vertical: vertical.id, zip }),
        }).catch(() => null);
        setState({
          job_id: jobId,
          phase: "calling",
          job_spec: jobSpec,
          sessions: emptySessions(vertical),
          ranked: [],
        });
        requestAnimationFrame(() => {
          chatsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        const startRes = await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId }),
        });
        if (!startRes.ok) throw new Error("Could not start negotiations");
        setStatus("Your negotiator is talking to 3 providers…");
        startPolling(jobId, vertical);
        setFile(null);
        return;
      }

      if (prompt.trim()) {
        // Text path: create once → extract → confirm → start (same job id)
        const createRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vertical: vertical.id,
            job_spec: jobSpec,
          }),
        });
        if (!createRes.ok) throw new Error("Could not create job");
        const created = (await createRes.json()) as {
          job?: { id: string };
          id?: string;
        };
        const jobId = created.job?.id || created.id;
        if (!jobId) throw new Error("No job id");

        const extractRes = await fetch(`/api/jobs/${jobId}/extract-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt.trim() }),
        });
        if (extractRes.ok) {
          const extracted = (await extractRes.json()) as {
            job?: { job_spec?: JobSpec };
          };
          jobSpec = { ...jobSpec, ...(extracted.job?.job_spec || {}) };
        } else {
          jobSpec = { ...jobSpec, notes: prompt.trim() };
        }

        const confirmRes = await fetch(`/api/jobs/${jobId}/confirm`, {
          method: "PATCH",
        });
        if (!confirmRes.ok) throw new Error("Could not confirm job");

        const zip = String(jobSpec.zip || "28202");
        setStage("working");
        setStatus("Finding local providers…");
        await fetch("/api/discovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vertical: vertical.id, zip }),
        }).catch(() => null);

        setState({
          job_id: jobId,
          phase: "calling",
          job_spec: jobSpec,
          sessions: emptySessions(vertical),
          ranked: [],
        });
        requestAnimationFrame(() => {
          chatsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });

        setStatus("Your negotiator is talking to 3 providers…");
        const startRes = await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId }),
        });
        if (!startRes.ok) {
          const err = await startRes.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "Could not start negotiations",
          );
        }
        startPolling(jobId, vertical);
        return;
      }

      // Empty send → demo defaults for this mode (judges always have a path)
      setBusy(false);
      await runPipeline(demoJobSpec(vertical));
    } catch (err) {
      setBusy(false);
      setStage("compose");
      setError(err instanceof Error ? err.message : "Failed");
      setStatus(null);
    }
  };

  const onTalk = async () => {
    if (!vertical) return;
    setError(null);
    setTalkOpen(true);
    setStatus("Starting voice…");
    try {
      const res = await fetch("/api/intake/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical: vertical.id }),
      });
      if (!res.ok) throw new Error("Voice intake unavailable");
      const data = (await res.json()) as {
        intake_id: string;
        talk_url: string | null;
        signed_url: string | null;
      };
      setIntakeId(data.intake_id);
      setTalkUrl(data.talk_url);
      setStatus("Speak with Leverage — we fill the job for you");
      if (data.talk_url) {
        window.open(data.talk_url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice failed");
      setStatus(null);
    }
  };

  // Poll intake draft → auto-run when filled
  useEffect(() => {
    if (!intakeId || !vertical || stage === "working") return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/intake/status?intake_id=${intakeId}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          status?: string;
          job_spec?: JobSpec | null;
        };
        if (cancelled) return;
        if (data.status === "filled" && data.job_spec) {
          clearInterval(id);
          setTalkOpen(false);
          setStatus("Got it — starting negotiations…");
          await runPipeline({
            ...demoJobSpec(vertical),
            ...data.job_spec,
          });
        }
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intakeId, vertical, stage, runPipeline]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
  };

  const sessions = state?.sessions || [];
  const jobType =
    (state?.job_spec?.job_type as string) ||
    (state?.job_spec?.job_kind as string) ||
    vertical?.default_job_type ||
    null;
  const ranked =
    state && vertical
      ? state.phase === "complete" && state.ranked.length === 0
        ? rankSessions(state.sessions, vertical, jobType)
        : state.ranked
      : [];
  const dealReview = state?.deal_review;
  const top =
    ranked.find((r) => r.recommended && !r.red_flag) ||
    ranked.find((r) => !r.red_flag) ||
    null;

  const showResults = stage === "working" || stage === "done" || Boolean(state);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[var(--max)] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div
              className="h-7 w-7 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, #c4b5fd, #7c3aed 55%, #0c0b0a)",
              }}
              aria-hidden
            />
            <span className="text-[15px] font-semibold tracking-tight">
              Leverage<span className="font-normal text-[var(--ink-muted)]">.AI</span>
            </span>
          </div>
          <a
            href="/demo?replay=true"
            className="text-[12px] text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          >
            Sample replay
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[var(--max)] px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        {/* Hero + composer */}
        <section
          className={`mx-auto flex max-w-[680px] flex-col items-center text-center ${
            showResults ? "mb-10" : "min-h-[52vh] justify-center"
          }`}
        >
          {!showResults && (
            <>
              <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">
                Get the best deal without the phone tag
              </h1>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                Tell us what you need. We talk to several providers at once,
                compare prices, and show you one clear recommendation.
              </p>
            </>
          )}

          <form
            onSubmit={(e) => void onSend(e)}
            className={`composer-shell mt-8 w-full rounded-2xl border border-[var(--border)] bg-white p-3 text-left shadow-[var(--shadow-sm)] ${
              showResults ? "" : ""
            }`}
          >
            {/* Mode dropdown (Claude-style) */}
            <div className="relative mb-2" ref={modeRef}>
              <button
                type="button"
                onClick={() => setModeOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1 text-[13px] font-medium text-[var(--ink)]"
                disabled={busy}
              >
                {modeMeta.label}
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path
                    d="M3 4.5 L6 7.5 L9 4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </button>
              {modeOpen && (
                <div className="mode-menu absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-white py-1 shadow-[var(--shadow-md)]">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`flex w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--accent-soft)] ${
                        m.id === mode ? "bg-[var(--accent-soft)]" : ""
                      }`}
                      onClick={() => {
                        setMode(m.id);
                        setModeOpen(false);
                        setState(null);
                        setStage("compose");
                        setStatus(null);
                        setError(null);
                      }}
                    >
                      <span className="text-[13px] font-medium">{m.label}</span>
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        {m.hint}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={modeMeta.placeholder}
              rows={showResults ? 2 : 3}
              disabled={busy}
              className="w-full resize-none border-0 bg-transparent px-1 py-1 text-[15px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
            />

            {file && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-[var(--accent-soft)] px-2 py-1.5 text-[12px]">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className="ml-auto text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Remove
                </button>
              </div>
            )}

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="hidden"
                onChange={onFile}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                Upload
              </button>
              <button
                type="button"
                onClick={() => void onTalk()}
                disabled={busy}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                Talk to Leverage
              </button>
              <button
                type="button"
                disabled={busy || !vertical}
                onClick={() => {
                  if (!vertical) return;
                  void runPipeline(demoJobSpec(vertical));
                }}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] text-[var(--ink-secondary)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                Use sample job
              </button>
              <button
                type="submit"
                disabled={busy || !vertical}
                className="ml-auto rounded-full bg-[var(--accent)] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              >
                {busy ? "Working…" : "Send"}
              </button>
            </div>
          </form>

          {(status || error || talkOpen) && (
            <div className="mt-4 w-full text-center text-[13px]">
              {error && <p className="text-[var(--danger)]">{error}</p>}
              {!error && status && (
                <p className="flex items-center justify-center gap-2 text-[var(--ink-secondary)]">
                  {(stage === "working" || busy) && (
                    <span className="pulse-dot" />
                  )}
                  {status}
                </p>
              )}
              {talkOpen && talkUrl && (
                <p className="mt-1 text-[12px] text-[var(--ink-muted)]">
                  Voice window opened. When you finish, we pick up the job
                  automatically.
                </p>
              )}
              {liveAvailable && stage === "compose" && (
                <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                  Live multi-agent mode available
                </p>
              )}
            </div>
          )}
        </section>

        {/* Three agent chats */}
        {showResults && vertical && (
          <section ref={chatsRef} className="stage-enter mb-10">
            <div className="mb-4 text-center">
              <h2 className="text-[18px] font-semibold tracking-tight">
                Your negotiator is talking to three providers
              </h2>
              <p className="mt-1 text-[13px] text-[var(--ink-secondary)]">
                Each chat is a different company style — so you see real tradeoffs,
                not one sales pitch.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {natures.map((n) => {
                const session =
                  sessions.find((s) => s.vendor_id === n.id) ||
                  sessions.find(
                    (s) =>
                      s.vendor_name?.toLowerCase() === n.name.toLowerCase(),
                  );
                return (
                  <WaChat
                    key={n.id}
                    name={session?.vendor_name || n.name}
                    nature={n.nature}
                    lines={session?.transcript || []}
                    status={session?.status || "idle"}
                    total={session?.current_price ?? null}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Deal below chats */}
        {showResults && (
          <section
            ref={dealRef}
            className={`stage-enter rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)] ${
              stage === "done" ? "" : "opacity-90"
            }`}
          >
            <h2 className="text-[18px] font-semibold tracking-tight">
              Your deal
            </h2>
            {stage !== "done" && !dealReview && (
              <p className="mt-2 text-[14px] text-[var(--ink-secondary)]">
                Waiting for all three negotiations to finish…
              </p>
            )}
            {(dealReview || top) && (
              <div className="mt-4 space-y-4">
                <p className="text-[20px] font-semibold tracking-tight">
                  {dealReview?.headline ||
                    (top
                      ? `Recommended: ${top.session.vendor_name}${
                          top.session.current_price != null
                            ? ` at ${formatUsd(top.session.current_price)}`
                            : ""
                        }`
                      : "Comparing…")}
                </p>
                {dealReview?.why_top?.length ? (
                  <ul className="space-y-1.5 text-[14px] text-[var(--ink-secondary)]">
                    {dealReview.why_top.map((line, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-[var(--ink-muted)]">·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {dealReview?.how_others_compared?.length ? (
                  <div>
                    <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                      The others
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[13px] text-[var(--ink-secondary)]">
                      {dealReview.how_others_compared.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {typeof dealReview?.confidence === "number" && (
                  <p className="text-[12px] text-[var(--ink-muted)]">
                    Confidence {dealReview.confidence}%
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

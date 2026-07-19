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
import { DiscoveryPanel } from "./DiscoveryPanel";
import { LearningPanel } from "./LearningPanel";

const MODES = [
  {
    id: "hvac",
    label: "HVAC",
    hint: "Cooling & heating quotes",
    placeholder:
      "Describe the job — e.g. 3-ton AC not cooling in 28202, need replacement this week",
    sample:
      "3-ton central AC not cooling in ZIP 28202. System is about 12 years old. Need replacement quotes this week.",
  },
  {
    id: "movers",
    label: "Local move",
    hint: "Moving company quotes",
    placeholder:
      "e.g. 2-bed apartment from Rock Hill to Charlotte, packing help, this weekend",
    sample:
      "2-bed apartment move from Rock Hill SC to Charlotte NC this weekend. Need packing help and three quotes.",
  },
  {
    id: "medical-imaging",
    label: "Cash MRI",
    hint: "Imaging cash prices",
    placeholder: "e.g. MRI knee without contrast, cash price, ZIP 28202",
    sample:
      "MRI of the knee without contrast, cash-pay price, ZIP 28202. Flexible on appointment timing.",
  },
  {
    id: "auto-repair",
    label: "Auto repair",
    hint: "Shop repair quotes",
    placeholder: "e.g. 2018 Honda Civic check-engine light, ZIP 28202",
    sample:
      "2018 Honda Civic check-engine light on, ZIP 28202. Need diagnostic and repair quotes this week.",
  },
] as const;

type ModeId = (typeof MODES)[number]["id"];

type AgentNature = {
  id: string;
  name: string;
  oneWord: string;
  nature4: string;
  role?: string;
};

const NATURE_4: Record<string, string> = {
  tough: "Quality over lowest price",
  stonewaller: "Visit before firm quote",
  upseller: "Low price watch fees",
};

function oneWordName(name: string): string {
  const t = name.trim();
  if (!t) return "Shop";
  // CamelCase / compound product names stay one token
  if (!/\s/.test(t)) return t.replace(/[^a-zA-Z0-9]/g, "") || t;
  return t.split(/\s+/)[0];
}

function fourWordNature(
  nature: string,
  role?: string,
  roleLabel?: string,
): string {
  if (role && NATURE_4[role]) return NATURE_4[role];
  const lower = (roleLabel || nature || "").toLowerCase();
  if (lower.includes("careful") || lower.includes("quality"))
    return "Quality over lowest price";
  if (lower.includes("cautious") || lower.includes("visit"))
    return "Visit before firm quote";
  if (lower.includes("bargain") || lower.includes("fee"))
    return "Low price watch fees";
  const words = nature
    .replace(/[—–].*$/, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 4) return words.slice(0, 4).join(" ");
  while (words.length < 4) words.push("deal");
  return words.slice(0, 4).join(" ");
}

function naturesFromVertical(v: VerticalConfig | null): AgentNature[] {
  if (!v?.vendors?.length) {
    return [
      {
        id: "tough",
        name: "Summit",
        oneWord: "Summit",
        nature4: "Quality over lowest price",
        role: "tough",
      },
      {
        id: "stonewaller",
        name: "ComfortPro",
        oneWord: "ComfortPro",
        nature4: "Visit before firm quote",
        role: "stonewaller",
      },
      {
        id: "upseller",
        name: "ValueHVAC",
        oneWord: "ValueHVAC",
        nature4: "Low price watch fees",
        role: "upseller",
      },
    ];
  }
  return v.vendors.map((vendor) => {
    const full = vendor.displayName || vendor.name || vendor.id;
    const nature =
      (vendor as { nature?: string }).nature ||
      vendor.role_label ||
      vendor.public_blurb ||
      "Negotiating on your behalf";
    const role = vendor.role || vendor.persona || vendor.id;
    return {
      id: vendor.id,
      name: full,
      oneWord: oneWordName(full),
      nature4: fourWordNature(String(nature), role, vendor.role_label),
      role,
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

/** Relative seconds from first message; handles epoch ms/s and raw offsets. */
function relativeSeconds(lines: TranscriptLine[], line: TranscriptLine): number {
  const nums = lines
    .map((l) => l.ts)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!nums.length || typeof line.ts !== "number" || !Number.isFinite(line.ts)) {
    return 0;
  }
  const max = Math.max(...nums);
  // epoch ms → s; long ms-offsets into a call → s; else already seconds
  const scale =
    max > 1e12 ? 1000 : max > 1000 && max < 1e11 ? 1000 : 1;
  const base = Math.min(...nums.map((n) => n / scale));
  const t = line.ts / scale;
  return Math.max(0, Math.round(t - base));
}

const STATUS_STEPS = [
  { id: "match", label: "Matching shops" },
  { id: "connect", label: "Connecting" },
  { id: "negotiate", label: "Negotiating in parallel" },
  { id: "build", label: "Building deal" },
  { id: "ready", label: "Deal ready" },
] as const;

type StatusStepId = (typeof STATUS_STEPS)[number]["id"];

function CloudBackdrop() {
  return (
    <div className="cloud-sky" aria-hidden>
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />
      <div className="cloud cloud-d" />
      <div className="cloud cloud-e" />
    </div>
  );
}

function StatusStrip({ active }: { active: StatusStepId | null }) {
  if (!active) return null;
  const idx = STATUS_STEPS.findIndex((s) => s.id === active);
  return (
    <div className="status-strip glass-panel-strong mx-auto max-w-3xl">
      {STATUS_STEPS.map((step, i) => (
        <span key={step.id} className="contents">
          {i > 0 && <span className="status-step-sep" aria-hidden />}
          <span
            className={`status-step ${
              i < idx ? "is-done" : i === idx ? "is-active" : ""
            }`}
          >
            {i === idx && <span className="pulse-dot" />}
            {i < idx && (
              <span className="text-[11px] text-[var(--success)]">✓</span>
            )}
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function WaChat({
  oneWord,
  nature4,
  lines,
  status,
  total,
}: {
  oneWord: string;
  nature4: string;
  lines: TranscriptLine[];
  status: string;
  total: number | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines.length]);

  const live = status === "negotiating" || status === "dialing";
  const done = status === "done" || status === "declined";
  const initial = oneWord.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="wa-shell min-h-0 flex-1">
      <div className="wa-header">
        <div className="wa-avatar">{initial}</div>
        <div className="min-w-0 flex-1">
          <div className="wa-title truncate">{oneWord}</div>
          <div className="wa-nature truncate">{nature4}</div>
        </div>
        {live && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
            <span className="pulse-dot" />
            Live
          </span>
        )}
        {done && !live && (
          <span className="text-[11px] text-[var(--ink-muted)]">
            {status === "declined" ? "No quote" : "Done"}
          </span>
        )}
      </div>
      <div className="wa-thread">
        {lines.length === 0 && (
          <p className="m-auto text-center text-[12px] text-[var(--ink-muted)]">
            {live ? "Connecting…" : "Waiting to start"}
          </p>
        )}
        {lines.map((line) => {
          const out = line.speaker === "negotiator";
          const sec = relativeSeconds(lines, line);
          return (
            <div
              key={line.id}
              className={`flex wa-pop ${out ? "justify-end" : "justify-start"}`}
            >
              <div className={out ? "wa-bubble-out" : "wa-bubble-in"}>
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-black/30">
                  {out ? "You" : oneWord}
                </div>
                {line.text}
                <div className="wa-meta">
                  <span>{sec}s</span>
                  {out ? <span className="wa-ticks">✓✓</span> : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {total != null && (
        <div className="wa-footer">Latest total: {formatUsd(total)}</div>
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
  const [statusStep, setStatusStep] = useState<StatusStepId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<JobState | null>(null);
  const [stage, setStage] = useState<"compose" | "working" | "done">("compose");
  const [talkOpen, setTalkOpen] = useState(false);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [talkUrl, setTalkUrl] = useState<string | null>(null);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoveryZip, setDiscoveryZip] = useState("28202");

  const chatsRef = useRef<HTMLDivElement>(null);
  const dealRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollJobIdRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const natures = useMemo(() => naturesFromVertical(vertical), [vertical]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollJobIdRef.current = null;
  }, []);

  // Stop polling on unmount
  useEffect(() => () => stopPoll(), [stopPoll]);

  // Stop polling when mode changes (new vertical context)
  useEffect(() => {
    stopPoll();
  }, [mode, stopPoll]);

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
    setLiveAvailable(
      Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID),
    );
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
      pollJobIdRef.current = jobId;
      const capturedJobId = jobId;
      setStatusStep("negotiate");
      const tick = async () => {
        // Ignore stale polls after mode change / new job / stopPoll
        if (pollJobIdRef.current !== capturedJobId) return;
        try {
          const res = await fetch(`/api/jobs/${capturedJobId}/state`, {
            cache: "no-store",
          });
          if (pollJobIdRef.current !== capturedJobId) return;
          if (!res.ok) return;
          const raw = await res.json();
          if (pollJobIdRef.current !== capturedJobId) return;
          let next = normalizeApiState(raw, cfg);
          if (!next) return;
          if (pollJobIdRef.current !== capturedJobId) return;

          const sessions = next.sessions || [];
          const allDone =
            sessions.length > 0 &&
            sessions.every(
              (s) => s.status === "done" || s.status === "declined",
            );
          const hasReview = Boolean(next.deal_review);
          const complete =
            next.phase === "complete" || hasReview || allDone;

          // Client-rank whenever all sessions done so ranked is never empty
          if (
            allDone &&
            (!next.ranked || next.ranked.length === 0)
          ) {
            const jobType =
              (next.job_spec?.job_type as string) ||
              (next.job_spec?.job_kind as string) ||
              cfg.default_job_type ||
              null;
            next = {
              ...next,
              phase: complete ? "complete" : next.phase,
              ranked: rankSessions(next.sessions, cfg, jobType),
            };
          }

          if (pollJobIdRef.current !== capturedJobId) return;
          setState(next);

          if (complete) {
            stopPoll();
            setBusy(false);
            setStage("done");
            setStatusStep("ready");
            setStatus("Done — your deal is ready");
            if (next.phase !== "complete") {
              setState({ ...next, phase: "complete" });
            }
            requestAnimationFrame(() => {
              dealRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            });
          } else if (sessions.some((s) => s.status === "negotiating")) {
            setStatusStep("negotiate");
          } else if (sessions.some((s) => s.status === "dialing")) {
            setStatusStep("connect");
          } else if (allDone) {
            setStatusStep("build");
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

  const beginNegotiations = useCallback(
    async (jobId: string, jobSpec: JobSpec, cfg: VerticalConfig) => {
      const zip = String(jobSpec.zip || cfg.demo_defaults?.zip || "28202");
      setDiscoveryZip(zip);
      setShowDiscovery(true);
      setStatusStep("match");
      setStatus("Matching local shops…");
      setStage("working");

      await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical: cfg.id, zip }),
      }).catch(() => null);

      setStatusStep("connect");
      setStatus("Connecting to three providers…");
      setState({
        job_id: jobId,
        phase: "calling",
        job_spec: jobSpec,
        sessions: emptySessions(cfg),
        ranked: [],
      });

      requestAnimationFrame(() => {
        chatsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });

      setStatus("Negotiating in parallel…");
      setStatusStep("negotiate");
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
      startPolling(jobId, cfg);
    },
    [startPolling],
  );

  const runPipeline = useCallback(
    async (jobSpec: JobSpec) => {
      if (!vertical) return;
      stopPoll();
      setBusy(true);
      setError(null);
      setStage("working");
      setStatus("Confirming your job…");
      setStatusStep("match");

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

        await beginNegotiations(jobId, jobSpec, vertical);
      } catch (e) {
        setBusy(false);
        setStage("compose");
        setError(e instanceof Error ? e.message : "Something went wrong");
        setStatus(null);
        setStatusStep(null);
        setShowDiscovery(false);
      }
    },
    [vertical, beginNegotiations, stopPoll],
  );

  const onSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!vertical || busy) return;
    stopPoll();
    setError(null);

    let jobSpec: JobSpec = { ...demoJobSpec(vertical) };

    try {
      setBusy(true);
      setStatus("Reading your request…");
      setStatusStep("match");

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
        const confirmRes = await fetch(`/api/jobs/${jobId}/confirm`, {
          method: "PATCH",
        });
        if (!confirmRes.ok) throw new Error("Could not confirm job");
        await beginNegotiations(jobId, jobSpec, vertical);
        setFile(null);
        return;
      }

      if (prompt.trim()) {
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

        await beginNegotiations(jobId, jobSpec, vertical);
        return;
      }

      // Empty send → demo defaults for this mode
      setBusy(false);
      await runPipeline(demoJobSpec(vertical));
    } catch (err) {
      setBusy(false);
      setStage("compose");
      setError(err instanceof Error ? err.message : "Failed");
      setStatus(null);
      setStatusStep(null);
      setShowDiscovery(false);
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

  const fillSampleJob = () => {
    // ONLY fills the text box — does not start negotiations
    setPrompt(modeMeta.sample);
    setError(null);
    setStatus("Sample job loaded — press Send when ready");
  };

  const sessions = state?.sessions || [];
  const jobType =
    (state?.job_spec?.job_type as string) ||
    (state?.job_spec?.job_kind as string) ||
    vertical?.default_job_type ||
    null;
  const allSessionsDone =
    sessions.length > 0 &&
    sessions.every((s) => s.status === "done" || s.status === "declined");
  const allTerminalWithOutcomes =
    sessions.length > 0 &&
    sessions.every(
      (s) =>
        (s.status === "done" || s.status === "declined") &&
        s.outcome != null,
    );

  // Client-rank whenever all sessions done so ranked is not empty
  const ranked =
    state && vertical
      ? (state.phase === "complete" ||
          stage === "done" ||
          allSessionsDone) &&
        state.ranked.length === 0
        ? rankSessions(state.sessions, vertical, jobType)
        : state.ranked
      : [];
  const dealReview = state?.deal_review;
  const top =
    ranked.find((r) => r.recommended && !r.red_flag) ||
    ranked.find((r) => !r.red_flag) ||
    null;

  // Only ready when we have real content — never empty "Recommendation ready"
  const dealReady =
    Boolean(dealReview) ||
    ranked.length > 0 ||
    allTerminalWithOutcomes;

  const hasExportableDeal =
    Boolean(dealReview) ||
    ranked.some(
      (r) =>
        r.session.current_price != null ||
        r.session.outcome === "itemized_quote" ||
        r.session.outcome === "callback_commitment" ||
        r.session.outcome === "documented_decline",
    ) ||
    sessions.some(
      (s) =>
        s.current_price != null ||
        s.outcome === "itemized_quote" ||
        s.outcome === "callback_commitment" ||
        s.outcome === "documented_decline",
    );

  const showResults = stage === "working" || stage === "done" || Boolean(state);

  const exportReport = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      vertical: vertical?.id,
      job_id: state?.job_id,
      job_spec: state?.job_spec,
      deal_review: dealReview || null,
      ranked: ranked.map((r) => ({
        rank: r.rank,
        vendor_id: r.session.vendor_id,
        vendor_name: r.session.vendor_name,
        total: r.session.current_price,
        recommended: r.recommended,
        red_flag: r.red_flag,
        why: r.why,
        outcome: r.session.outcome,
        line_items: r.session.line_items,
      })),
      quotes: sessions.map((s) => ({
        vendor_id: s.vendor_id,
        vendor_name: s.vendor_name,
        status: s.status,
        current_price: s.current_price,
        outcome: s.outcome,
        line_items: s.line_items,
        red_flag: s.red_flag,
      })),
      transcripts: sessions.map((s) => ({
        vendor_id: s.vendor_id,
        vendor_name: s.vendor_name,
        lines: s.transcript.map((l) => ({
          speaker: l.speaker,
          text: l.text,
          ts: l.ts,
        })),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leverage-deal-${state?.job_id || "report"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="portal-outer text-[var(--ink)]">
      <div className="portal-frame">
        <CloudBackdrop />

        <div className="portal-content">
        <header className="glass-header sticky top-0 z-30">
          <div className="mx-auto flex max-w-[var(--max)] items-center justify-between px-4 py-3 sm:px-6">
            <a href="/" className="logo-mark no-underline" aria-label="LEVERAGE home">
              <span className="logo-leverage">LEVERAGE</span>
            </a>
            <nav className="flex items-center gap-4">
              <a
                href="/live"
                className="text-[12px] text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
              >
                Sample replay
              </a>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[var(--max)] px-3 pb-24 pt-8 sm:px-5 sm:pt-12">
          {/* Hero + composer */}
          <section
            className={`mx-auto flex flex-col items-center text-center ${
              showResults ? "mb-6 max-w-3xl" : "min-h-[42vh] max-w-[680px] justify-center"
            }`}
          >
            {!showResults && (
              <>
                <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">
                  Better deals. Less phone tag.
                </h1>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--ink-secondary)]">
                  Describe the job once. Three shops negotiate in parallel —
                  one clear recommendation.
                </p>
              </>
            )}

            <form
              onSubmit={(e) => void onSend(e)}
              className="composer-shell glass-liquid-strong mt-6 w-full p-3 text-left"
            >
              <div className="relative mb-2" ref={modeRef}>
                <button
                  type="button"
                  onClick={() => setModeOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-dark)] bg-white/50 px-3 py-1 text-[13px] font-medium text-[var(--ink)]"
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
                  <div className="mode-menu absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-white/90 py-1 shadow-[var(--shadow-md)] backdrop-blur-xl">
                    {MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`flex w-full flex-col items-start px-3 py-2 text-left hover:bg-black/5 ${
                          m.id === mode ? "bg-black/[0.04]" : ""
                        }`}
                        onClick={() => {
                          stopPoll();
                          setMode(m.id);
                          setModeOpen(false);
                          setState(null);
                          setStage("compose");
                          setStatus(null);
                          setStatusStep(null);
                          setError(null);
                          setShowDiscovery(false);
                          setBusy(false);
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
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/40 px-2 py-1.5 text-[12px]">
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
                  className="rounded-full border border-[var(--border-dark)] bg-white/40 px-3 py-1.5 text-[13px] text-[var(--ink-secondary)] hover:bg-white/70 disabled:opacity-50"
                >
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => void onTalk()}
                  disabled={busy}
                  className="rounded-full border border-[var(--border-dark)] bg-white/40 px-3 py-1.5 text-[13px] text-[var(--ink-secondary)] hover:bg-white/70 disabled:opacity-50"
                >
                  Talk to Leverage
                </button>
                <button
                  type="button"
                  disabled={busy || !vertical}
                  onClick={fillSampleJob}
                  className="rounded-full border border-[var(--border-dark)] bg-white/40 px-3 py-1.5 text-[13px] text-[var(--ink-secondary)] hover:bg-white/70 disabled:opacity-50"
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

            {(status || error || talkOpen) && !showResults && (
              <div className="mt-4 w-full text-center text-[13px]">
                {error && <p className="text-[var(--danger)]">{error}</p>}
                {!error && status && (
                  <p className="flex items-center justify-center gap-2 text-[var(--ink-secondary)]">
                    {busy && <span className="pulse-dot" />}
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

          {/* Progressive status strip */}
          {showResults && statusStep && (
            <div className="mb-5 stage-enter">
              <StatusStrip active={statusStep} />
              {error && (
                <p className="mt-2 text-center text-[13px] text-[var(--danger)]">
                  {error}
                </p>
              )}
            </div>
          )}

          {/* Discovery + ranking (before / as chats) */}
          {showResults && showDiscovery && vertical && (
            <section className="stage-enter mb-5">
              <DiscoveryPanel
                vertical={vertical}
                zip={discoveryZip}
                compact
                busy={busy && !state}
              />
            </section>
          )}

          {/* Three agent chats — wide grid, tall bodies */}
          {showResults && vertical && (
            <section ref={chatsRef} className="stage-enter mb-8">
              <div className="mb-3 text-center">
                <h2 className="text-[17px] font-semibold tracking-tight">
                  Three providers. One negotiator. Live.
                </h2>
                <p className="mt-1 text-[13px] text-[var(--ink-secondary)]">
                  Parallel chats — different company styles, real tradeoffs.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
                {natures.map((n) => {
                  const session =
                    sessions.find((s) => s.vendor_id === n.id) ||
                    sessions.find(
                      (s) =>
                        s.vendor_name?.toLowerCase() === n.name.toLowerCase() ||
                        s.vendor_name
                          ?.toLowerCase()
                          .startsWith(n.oneWord.toLowerCase()),
                    );
                  return (
                    <WaChat
                      key={n.id}
                      oneWord={
                        session?.vendor_name
                          ? oneWordName(session.vendor_name)
                          : n.oneWord
                      }
                      nature4={n.nature4}
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
              className={`stage-enter glass-liquid p-5 sm:p-6 ${
                dealReady ? "" : "opacity-95"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="label-section">Your deal</p>
                  <h2 className="mt-0.5 text-[18px] font-semibold tracking-tight">
                    {dealReady ? "Recommendation ready" : "Building your deal"}
                  </h2>
                </div>
                {dealReady && hasExportableDeal && (
                  <button
                    type="button"
                    onClick={exportReport}
                    className="btn-pill btn-pill-primary shrink-0"
                  >
                    Export report
                  </button>
                )}
              </div>

              {!dealReady && (
                <p className="mt-3 text-[14px] text-[var(--ink-secondary)]">
                  Waiting for all three negotiations to finish…
                </p>
              )}

              {dealReady && (dealReview || top || ranked.length > 0 || allTerminalWithOutcomes) && (
                <div className="mt-4 space-y-4">
                  <p className="text-[20px] font-semibold tracking-tight">
                    {dealReview?.headline ||
                      (top
                        ? `Recommended: ${top.session.vendor_name}${
                            top.session.current_price != null
                              ? ` at ${formatUsd(top.session.current_price)}`
                              : ""
                          }`
                        : "Comparing outcomes…")}
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

                  {ranked.length > 0 && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {ranked.map((r) => (
                        <div
                          key={r.session.vendor_id + r.rank}
                          className={`glass-inner p-3 text-left ${
                            r.recommended && !r.red_flag
                              ? "ring-1 ring-[var(--success)]/40"
                              : ""
                          }`}
                        >
                          <p className="text-[12px] font-medium text-[var(--ink-muted)]">
                            #{r.rank}
                            {r.recommended ? " · pick" : ""}
                            {r.red_flag ? " · flag" : ""}
                          </p>
                          <p className="mt-0.5 text-[14px] font-semibold">
                            {oneWordName(r.session.vendor_name)}
                          </p>
                          <p className="text-[15px] tabular-nums">
                            {r.session.current_price != null
                              ? formatUsd(r.session.current_price)
                              : r.session.outcome === "documented_decline"
                                ? "No phone quote"
                                : "—"}
                          </p>
                          {r.why && (
                            <p className="mt-1 text-[11px] leading-snug text-[var(--ink-secondary)]">
                              {r.why}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {dealReady && vertical && (
                <div className="mt-5">
                  <LearningPanel vertical={vertical.id} />
                </div>
              )}
            </section>
          )}
        </main>
        </div>
      </div>
    </div>
  );
}

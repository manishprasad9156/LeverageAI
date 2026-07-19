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

import { DiscoveryPanel } from "./DiscoveryPanel";
import { LearningPanel } from "./LearningPanel";
import { Top3Map } from "./Top3Map";
import { SiteHeader } from "./SiteHeader";
import { openDealPdf } from "@/lib/ui/exportDealPdf";
import { isDisplayableTranscript } from "@/lib/evidence/transcript";

const MODES = [
  {
    id: "hvac",
    label: "HVAC",
    hint: "Cooling & heating quotes",
    typewriters: [
      "My AC stopped cooling in Chicago, ZIP 60614…",
      "Need a 3-ton central AC replacement in Austin TX…",
      "Furnace not heating, Brooklyn 11201, this week…",
      "Heat pump quote near Seattle, WA 98101…",
    ],
  },
  {
    id: "movers",
    label: "Local move",
    hint: "Moving company quotes",
    typewriters: [
      "2-bed move from Denver to Boulder this weekend…",
      "Local apartment move in Atlanta, packing help…",
      "House move Dallas to Fort Worth, next Friday…",
      "Studio move in Portland OR with stairs…",
    ],
  },
  {
    id: "medical-imaging",
    label: "Cash MRI",
    hint: "Imaging cash prices",
    typewriters: [
      "Cash MRI knee without contrast, Phoenix AZ…",
      "MRI brain cash price near Miami 33101…",
      "Need cash-pay lumbar MRI in Boston…",
      "Shoulder MRI quote, San Diego area…",
    ],
  },
  {
    id: "auto-repair",
    label: "Auto repair",
    hint: "Shop repair quotes",
    typewriters: [
      "2019 Toyota Camry brakes, Houston 77002…",
      "Check-engine light on my Honda, Minneapolis…",
      "2018 Civic AC not cold, ZIP 85001…",
      "Oil leak repair quote near Detroit…",
    ],
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
        name: "ProviderA",
        oneWord: "ProviderA",
        nature4: "Quality over lowest price",
        role: "tough",
      },
      {
        id: "stonewaller",
        name: "ProviderB",
        oneWord: "ProviderB",
        nature4: "Visit before firm quote",
        role: "stonewaller",
      },
      {
        id: "upseller",
        name: "ProviderC",
        oneWord: "ProviderC",
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
      <video
        className="cloud-video"
        autoPlay
        muted
        loop
        playsInline
        poster="/media/clouds-poster.jpg"
      >
        <source src="/media/clouds-loop.mp4" type="video/mp4" />
      </video>
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />
    </div>
  );
}

/** Real-time progress 0–100 from agent activity */
function progressFromState(
  step: StatusStepId | null,
  sessions: { status: string; transcript: unknown[] }[],
  dealReady: boolean,
): number {
  if (dealReady || step === "ready") return 100;
  if (step === "build") return 88;
  if (step === "match") return 18;
  if (step === "connect") return 32;
  if (step === "negotiate" || sessions.length > 0) {
    const n = Math.max(1, sessions.length);
    const live = sessions.filter(
      (s) => s.status === "negotiating" || s.status === "dialing",
    ).length;
    const done = sessions.filter(
      (s) => s.status === "done" || s.status === "declined",
    ).length;
    const msgs = sessions.reduce(
      (a, s) => a + (s.transcript?.length || 0),
      0,
    );
    const msgPart = Math.min(30, msgs * 1.2);
    const donePart = (done / n) * 40;
    const livePart = (live / n) * 10;
    return Math.min(86, Math.round(35 + msgPart + donePart + livePart));
  }
  return step ? 12 : 0;
}

function StatusStrip({
  active,
  progress,
}: {
  active: StatusStepId | null;
  progress: number;
}) {
  if (!active && progress <= 0) return null;
  const idx = active
    ? STATUS_STEPS.findIndex((s) => s.id === active)
    : progress >= 100
      ? STATUS_STEPS.length - 1
      : 0;
  return (
    <div className="status-strip glass-liquid mx-auto max-w-3xl">
      <div
        className="status-progress-track"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="status-progress-fill"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      <div className="status-steps-row">
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
    </div>
  );
}

function WaChat({
  oneWord,
  nature4,
  lines,
  status,
  total,
  audioUrl,
  sessionId,
}: {
  oneWord: string;
  nature4: string;
  lines: TranscriptLine[];
  status: string;
  total: number | null;
  audioUrl?: string | null;
  sessionId?: string;
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
        {lines
          .filter((line) => {
            const t = (line.text || "").trim();
            if (!t || t === "…" || t === "..." || t.length < 2) return false;
            if (!isDisplayableTranscript(t)) return false;
            // Drop useless partials that look like truncated speech
            if (/^(Hello|Hi|Yes|I am|I'|We)[,.]?\s*(\.\.\.|…)?$/i.test(t))
              return false;
            return true;
          })
          .map((line) => {
          const out = line.speaker === "negotiator";
          const sec = relativeSeconds(lines, line);
          return (
            <div
              key={line.id}
              id={sessionId ? `transcript-${sessionId}-${Math.round(line.ts)}` : undefined}
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
      {(total != null || audioUrl) && (
        <div className="wa-footer flex flex-wrap items-center gap-2">
          {total != null && <span>Latest total: {formatUsd(total)}</span>}
          {audioUrl && (
            <audio
              className="ml-auto h-7 max-w-[155px]"
              controls
              preload="none"
              src={audioUrl}
              aria-label={`${oneWord} call recording`}
            />
          )}
        </div>
      )}
    </div>
  );
}

type PendingJob = {
  id: string;
  spec: JobSpec;
};

type RecentRun = {
  job_id: string;
  vertical: ModeId;
  created_at: string;
  status: "review" | "running" | "complete";
  summary: string;
};

const RECENT_RUNS_KEY = "leverageai:anonymous-recent-runs:v1";

function readRecentRuns(): RecentRun[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_RUNS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function jobSpecToPrompt(spec: JobSpec): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(spec)) {
    if (
      value == null ||
      value === "" ||
      key === "job_type" ||
      key === "job_kind"
    ) {
      continue;
    }
    parts.push(`${key.replace(/_/g, " ")}: ${String(value)}`);
  }
  return parts.join(". ") + (parts.length ? "." : "");
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
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoveryZip, setDiscoveryZip] = useState("");
  const [discoveryLocation, setDiscoveryLocation] = useState("");
  const [discoveryGeo, setDiscoveryGeo] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [twDisplay, setTwDisplay] = useState("");
  const [focused, setFocused] = useState(false);
  const [pendingJob, setPendingJob] = useState<PendingJob | null>(null);
  const [fieldIssues, setFieldIssues] = useState<Record<string, string>>({});
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>(() =>
    typeof window === "undefined" ? [] : readRecentRuns(),
  );
  const [copiedDraft, setCopiedDraft] = useState(false);

  const chatsRef = useRef<HTMLDivElement>(null);
  const dealRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollJobIdRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const voiceFinalizingRef = useRef(false);

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const natures = useMemo(() => naturesFromVertical(vertical), [vertical]);

  const rememberRun = useCallback((run: RecentRun) => {
    setRecentRuns((previous) => {
      const existing = previous.find((item) => item.job_id === run.job_id);
      const stableRun = existing
        ? { ...run, created_at: existing.created_at }
        : run;
      const next = [stableRun, ...previous.filter((item) => item.job_id !== run.job_id)]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5);
      localStorage.setItem(RECENT_RUNS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Typewriter placeholders (3–4 lines, hold ~2.5s)
  useEffect(() => {
    if (focused || prompt.trim()) {
      return;
    }
    const lines = modeMeta.typewriters;
    let lineIdx = 0;
    let charIdx = 0;
    let phase: "type" | "hold" | "erase" = "type";
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const line = lines[lineIdx] || "";
      if (phase === "type") {
        charIdx += 1;
        setTwDisplay(line.slice(0, charIdx));
        if (charIdx >= line.length) {
          phase = "hold";
          timer = setTimeout(tick, 2500);
          return;
        }
        timer = setTimeout(tick, 28 + Math.random() * 24);
      } else if (phase === "hold") {
        phase = "erase";
        timer = setTimeout(tick, 40);
      } else {
        charIdx -= 1;
        setTwDisplay(line.slice(0, Math.max(0, charIdx)));
        if (charIdx <= 0) {
          lineIdx = (lineIdx + 1) % lines.length;
          phase = "type";
          timer = setTimeout(tick, 320);
          return;
        }
        timer = setTimeout(tick, 16);
      }
    };
    timer = setTimeout(tick, 400);
    return () => clearTimeout(timer);
  }, [modeMeta.typewriters, focused, prompt, mode]);

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
            rememberRun({
              job_id: capturedJobId,
              vertical: cfg.id as ModeId,
              created_at: new Date().toISOString(),
              status: "complete",
              summary:
                next.deal_review?.headline ||
                `${cfg.displayName || cfg.label || cfg.id} negotiation`,
            });
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
    [rememberRun, stopPoll],
  );

  const discoverProviders = useCallback(
    async (jobSpec: JobSpec, cfg: VerticalConfig): Promise<JobSpec> => {
      const locText = [
        jobSpec.zip,
        jobSpec.from_city,
        jobSpec.to_city,
        jobSpec.notes,
        prompt,
      ]
        .filter(Boolean)
        .map(String)
        .join(" ");

      setShowDiscovery(true);
      setStatusStep("match");
      setStatus("Building the real-world provider shortlist…");

      let zip = jobSpec.zip ? String(jobSpec.zip) : "";
      let locationLabel = locText;
      try {
        const discRes = await fetch("/api/discovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vertical: cfg.id,
            query_text: locText,
            location: locText,
            zip: zip || undefined,
          }),
        });
        if (discRes.ok) {
          const disc = (await discRes.json()) as {
            zip?: string;
            location?: string;
            geo?: { lat: number; lng: number } | null;
            error?: string;
          };
          if (disc.zip) zip = disc.zip;
          if (disc.location) locationLabel = disc.location;
          if (disc.geo?.lat != null && disc.geo?.lng != null) {
            setDiscoveryGeo({ lat: disc.geo.lat, lng: disc.geo.lng });
          }
        } else {
          const err = await discRes.json().catch(() => ({}));
          if ((err as { code?: string }).code === "LOCATION_REQUIRED") {
            throw new Error(
              "Add a city or ZIP so we can build a real provider shortlist.",
            );
          }
          throw new Error(
            (err as { error?: string }).error || "Provider discovery failed",
          );
        }
      } catch (e) {
        if (e instanceof Error) throw e;
        throw new Error("Provider discovery failed");
      }

      setDiscoveryZip(zip);
      setDiscoveryLocation(locationLabel);
      return zip && !jobSpec.zip ? { ...jobSpec, zip } : jobSpec;
    },
    [prompt],
  );

  const beginNegotiations = useCallback(
    async (jobId: string, jobSpec: JobSpec, cfg: VerticalConfig) => {
      setStage("working");

      setStatusStep("connect");
      setStatus("Multi-agent mode · connecting…");
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

      setStatus("Multi-agent mode · negotiating…");
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
          ? "Multi-agent mode · live"
          : "Multi-agent mode · running",
      );
      rememberRun({
        job_id: jobId,
        vertical: cfg.id as ModeId,
        created_at: new Date().toISOString(),
        status: "running",
        summary: `${cfg.displayName || cfg.label || cfg.id} negotiation`,
      });
      startPolling(jobId, cfg);
    },
    [rememberRun, startPolling],
  );

  const onSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!vertical || busy) return;
    stopPoll();
    setError(null);

    const initialSpec: JobSpec = {
      job_type: vertical.default_job_type || "job",
      job_kind: vertical.default_job_type || "job",
    };

    try {
      setBusy(true);
      setStatus("Reading your request…");
      setStatusStep("match");

      if (!file && !prompt.trim()) {
        setBusy(false);
        setError(
          "Describe the job and where it is (city or ZIP), then press Send.",
        );
        setStatus(null);
        setStatusStep(null);
        return;
      }

      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical: vertical.id,
          job_spec: initialSpec,
        }),
      });
      const created = (await createRes.json().catch(() => ({}))) as {
        job?: { id: string };
        id?: string;
        error?: string;
      };
      if (!createRes.ok) throw new Error(created.error || "Could not prepare request");
      const jobId = created.job?.id || created.id;
      if (!jobId) throw new Error("No job id");

      let extractRes: Response;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        if (prompt.trim()) form.append("text", prompt.trim());
        extractRes = await fetch(`/api/jobs/${jobId}/extract-pdf`, {
          method: "POST",
          body: form,
        });
      } else {
        extractRes = await fetch(`/api/jobs/${jobId}/extract-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: prompt.trim() }),
        });
      }
      const extracted = (await extractRes.json().catch(() => ({}))) as {
        error?: string;
        job?: { job_spec?: JobSpec };
        extraction?: {
          missing?: Array<{ field: string; message: string }>;
          invalid?: Array<{ field: string; message: string }>;
          warnings?: string[];
        };
      };
      if (!extractRes.ok) {
        throw new Error(extracted.error || "Could not read your request");
      }

      const spec = { ...initialSpec, ...(extracted.job?.job_spec || {}) };
      const issues: Record<string, string> = {};
      for (const issue of [
        ...(extracted.extraction?.missing || []),
        ...(extracted.extraction?.invalid || []),
      ]) {
        issues[issue.field] = issue.message;
      }
      setPendingJob({ id: jobId, spec });
      setFieldIssues(issues);
      setBusy(false);
      setStatusStep(null);
      setStatus("Review the details below before the demo negotiations start.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      rememberRun({
        job_id: jobId,
        vertical: vertical.id as ModeId,
        created_at: new Date().toISOString(),
        status: "review",
        summary: `${vertical.displayName || vertical.label || vertical.id} request`,
      });
    } catch (err) {
      setBusy(false);
      setStage("compose");
      setError(err instanceof Error ? err.message : "Failed");
      setStatus(null);
      setStatusStep(null);
      setShowDiscovery(false);
    }
  };

  const confirmAndStart = async () => {
    if (!vertical || !pendingJob || busy) return;
    const issues: Record<string, string> = {};
    for (const question of vertical.intake?.questions || []) {
      const value = pendingJob.spec[question.id];
      if (question.required && (value == null || String(value).trim() === "")) {
        issues[question.id] = "Required before negotiation can start";
      } else if (
        question.type === "number" &&
        value != null &&
        value !== "" &&
        !Number.isFinite(Number(value))
      ) {
        issues[question.id] = "Enter a valid number";
      }
    }
    if (Object.keys(issues).length) {
      setFieldIssues(issues);
      setError("Please complete the highlighted details.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Checking location and matching providers…");
    try {
      const resolvedSpec = await discoverProviders(pendingJob.spec, vertical);
      const confirmRes = await fetch(`/api/jobs/${pendingJob.id}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, job_spec: resolvedSpec }),
      });
      const confirmation = (await confirmRes.json().catch(() => ({}))) as {
        error?: string;
        missing?: Array<{ field: string; message: string }>;
        invalid?: Array<{ field: string; message: string }>;
      };
      if (!confirmRes.ok) {
        const serverIssues: Record<string, string> = {};
        for (const issue of [
          ...(confirmation.missing || []),
          ...(confirmation.invalid || []),
        ]) {
          serverIssues[issue.field] = issue.message;
        }
        setFieldIssues(serverIssues);
        throw new Error(confirmation.error || "Could not confirm request");
      }
      const jobId = pendingJob.id;
      setPendingJob(null);
      setFieldIssues({});
      await beginNegotiations(jobId, resolvedSpec, vertical);
    } catch (err) {
      setBusy(false);
      setStage("compose");
      setError(err instanceof Error ? err.message : "Could not start negotiations");
      setStatus(null);
      setStatusStep(null);
      setShowDiscovery(false);
    }
  };

  const onTalk = async () => {
    if (!vertical) return;
    setError(null);
    voiceFinalizingRef.current = false;
    setTalkOpen(true);
    setStatus("Speak with Leverage · we close the deal for you");
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
      setStatus("Multi-agent mode · voice");
      if (data.talk_url) {
        window.open(data.talk_url, "_blank", "noopener,noreferrer");
      } else {
        setError(
          "Voice agent not linked. Set ELEVENLABS_INTAKE_AGENT_ID and ensure submit_spec webhook hits this app.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice failed");
      setStatus(null);
    }
  };

  // Voice already returns a server-validated structured specification.
  // Create the review job directly instead of converting it back to prose and
  // running a lossy second extraction pass.
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
        if (
          data.status === "filled" &&
          data.job_spec &&
          !voiceFinalizingRef.current
        ) {
          voiceFinalizingRef.current = true;
          clearInterval(id);
          setTalkOpen(false);
          const filled = { ...data.job_spec };
          try {
            const createRes = await fetch("/api/jobs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                vertical: vertical.id,
                job_spec: filled,
              }),
            });
            const created = (await createRes.json().catch(() => ({}))) as {
              job?: { id?: string; job_spec?: JobSpec };
              error?: string;
            };
            if (!createRes.ok || !created.job?.id) {
              throw new Error(
                created.error || "Voice details could not be prepared for review",
              );
            }
            const reviewedSpec = created.job.job_spec || filled;
            setPrompt(jobSpecToPrompt(reviewedSpec));
            setPendingJob({ id: created.job.id, spec: reviewedSpec });
            setFieldIssues({});
            setState(null);
            setStage("compose");
            setBusy(false);
            setFile(null);
            setStatusStep(null);
            setStatus("Review the voice details below before negotiations start.");
            setError(null);
            setIntakeId(null);
            rememberRun({
              job_id: created.job.id,
              vertical: vertical.id as ModeId,
              created_at: new Date().toISOString(),
              status: "review",
              summary: `${vertical.displayName || vertical.label || vertical.id} voice request`,
            });
          } catch (voiceError) {
            voiceFinalizingRef.current = false;
            setError(
              voiceError instanceof Error
                ? voiceError.message
                : "Voice details could not be prepared for review",
            );
            setStatus(null);
          }
        }
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intakeId, vertical, stage, rememberRun]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
  };

  const openRecentRun = async (run: RecentRun) => {
    stopPoll();
    setBusy(true);
    setError(null);
    try {
      const [verticalRes, stateRes] = await Promise.all([
        fetch(`/api/vertical?id=${run.vertical}`, { cache: "no-store" }),
        fetch(`/api/jobs/${run.job_id}/state`, { cache: "no-store" }),
      ]);
      if (!verticalRes.ok || !stateRes.ok) {
        throw new Error("This anonymous run is no longer available on the server.");
      }
      const cfg = (await verticalRes.json()) as VerticalConfig;
      const raw = await stateRes.json();
      const next = normalizeApiState(raw, cfg);
      if (!next) throw new Error("The saved run could not be read.");
      setMode(run.vertical);
      setVertical(cfg);
      setPendingJob(null);
      setFieldIssues({});
      setState(next.phase === "draft" ? null : next);
      if (next.phase === "draft" && next.job_spec) {
        setPendingJob({ id: run.job_id, spec: next.job_spec });
        setStage("compose");
        setStatus("Review the saved details before starting.");
        setStatusStep(null);
        setBusy(false);
        return;
      }
      const complete = next.phase === "complete";
      setStage(complete ? "done" : "working");
      setShowDiscovery(true);
      setDiscoveryZip(String(next.job_spec?.zip || ""));
      setDiscoveryLocation(String(next.job_spec?.zip || ""));
      setStatusStep(complete ? "ready" : "negotiate");
      setStatus(complete ? "Done - your deal is ready" : "Negotiations in progress");
      setBusy(!complete);
      if (!complete) startPolling(run.job_id, cfg);
    } catch (loadError) {
      setBusy(false);
      setError(loadError instanceof Error ? loadError.message : "Could not open run");
    }
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

  const progressPct = progressFromState(
    statusStep,
    sessions,
    dealReady,
  );

  const exportReport = () => {
    openDealPdf({
      vertical: vertical?.id,
      jobId: state?.job_id,
      jobSpec: state?.job_spec || null,
      headline:
        dealReview?.headline ||
        (top
          ? `Your deal: ${top.session.vendor_name}${
              top.session.current_price != null
                ? ` at ${formatUsd(top.session.current_price)}`
                : ""
            }`
          : "Your deal"),
      whyTop: dealReview?.why_top || [],
      others: dealReview?.how_others_compared || [],
      confidence: dealReview?.confidence,
      ranked: ranked.map((r) => ({
        rank: r.rank,
        name: r.session.vendor_name,
        total:
          r.session.current_price != null
            ? formatUsd(r.session.current_price)
            : r.session.outcome === "documented_decline"
              ? "No phone quote"
              : r.session.outcome === "callback_commitment"
                ? "Callback"
                : "—",
        note: r.why,
        recommended: r.recommended && !r.red_flag,
      })),
    });
  };

  return (
    <div className="portal-outer text-[var(--ink)]">
      <div className="portal-frame">
        <CloudBackdrop />

        <div className="portal-content">
        <SiteHeader logoAsHomeLink />

        <main className="mx-auto max-w-[var(--max)] px-3 pb-24 pt-6 sm:px-5 sm:pt-10">
          {/* Hero + composer */}
          <section
            className={`mx-auto flex flex-col items-center text-center ${
              showResults ? "mb-6 max-w-3xl" : "min-h-[42vh] max-w-[680px] justify-center"
            }`}
          >
            {!showResults && (
              <h1 className="portal-headline font-instrument">
                <span className="landing-line">
                  You <em className="headline-em">name</em>
                  {" "}the job.
                </span>
                <span className="landing-line">
                  We <em className="headline-em">lock</em>
                  {" "}the price.
                </span>
              </h1>
            )}

            <form
              onSubmit={(e) => void onSend(e)}
              className="composer-shell glass-liquid-strong mt-6 w-full max-w-full p-3 text-left sm:p-4"
            >
              <div className="relative min-h-[4.5rem]">
                {!prompt && !focused && twDisplay && (
                  <div
                    className="pointer-events-none absolute inset-0 px-1 py-1 text-[15px] leading-relaxed text-[var(--ink-muted)]"
                    aria-hidden
                  >
                    {twDisplay}
                    <span className="type-caret">|</span>
                  </div>
                )}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={focused || prompt ? "" : " "}
                  rows={showResults ? 2 : 3}
                  disabled={busy}
                  className="relative z-[1] w-full resize-none border-0 bg-transparent px-1 py-1 text-[15px] leading-relaxed text-[var(--ink)] outline-none"
                />
              </div>

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

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,application/pdf,text/plain"
                  className="hidden"
                  onChange={onFile}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="icon-plus"
                  aria-label="Upload"
                  title="Upload"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => void onTalk()}
                  disabled={busy}
                  className="icon-plus"
                  aria-label="Voice mode"
                  title="Voice"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M5 11a7 7 0 0 0 14 0M12 18v3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative" ref={modeRef}>
                    <button
                      type="button"
                      onClick={() => setModeOpen((o) => !o)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/50 bg-white/35 px-3 py-1.5 text-[12px] font-medium"
                      disabled={busy}
                    >
                      {modeMeta.label}
                      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                        <path
                          d="M3 4.5 L6 7.5 L9 4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                      </svg>
                    </button>
                    {modeOpen && (
                      <div className="mode-menu absolute bottom-full right-0 z-20 mb-1 w-56 overflow-hidden rounded-xl border border-white/50 bg-white/95 py-1 shadow-lg">
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
                              setPendingJob(null);
                              setFieldIssues({});
                              setStage("compose");
                              setStatus(null);
                              setStatusStep(null);
                              setError(null);
                              setShowDiscovery(false);
                              setBusy(false);
                              setDiscoveryGeo(null);
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
                  <button
                    type="submit"
                    disabled={busy || !vertical || Boolean(pendingJob)}
                    className="btn-send"
                  >
                    {busy ? "…" : "Send"}
                  </button>
                </div>
              </div>
            </form>

            {pendingJob && vertical && (
              <div className="glass-liquid-strong mt-4 w-full p-4 text-left sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="label-section">Confirm the request</p>
                    <h2 className="mt-0.5 text-[17px] font-semibold">
                      Check what the agents will use
                    </h2>
                    <p className="mt-1 text-[12px] text-[var(--ink-secondary)]">
                      Missing details stay blank. Nothing is booked or purchased automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    onClick={() => {
                      setPendingJob(null);
                      setFieldIssues({});
                      setStatus(null);
                      setError(null);
                    }}
                  >
                    Start over
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {(vertical.intake?.questions || []).map((question) => {
                    const value = pendingJob.spec[question.id];
                    const issue = fieldIssues[question.id];
                    const update = (nextValue: string) => {
                      setPendingJob((current) =>
                        current
                          ? {
                              ...current,
                              spec: { ...current.spec, [question.id]: nextValue },
                            }
                          : current,
                      );
                      setFieldIssues((current) => {
                        const next = { ...current };
                        delete next[question.id];
                        return next;
                      });
                      setError(null);
                    };
                    return (
                      <label
                        key={question.id}
                        className={question.id === "notes" ? "sm:col-span-2" : ""}
                      >
                        <span className="text-[12px] font-medium text-[var(--ink)]">
                          {question.prompt} {question.required ? "*" : ""}
                        </span>
                        {question.type === "enum" || question.type === "boolean" ? (
                          <select
                            value={value == null ? "" : String(value)}
                            onChange={(event) => update(event.target.value)}
                            className={`mt-1 h-11 w-full rounded-xl border bg-white/55 px-3 text-[13px] outline-none ${
                              issue ? "border-[var(--danger)]" : "border-white/60"
                            }`}
                          >
                            <option value="">Select…</option>
                            {(question.options ||
                              (question.type === "boolean" ? ["yes", "no"] : [])
                            ).map((option) => (
                              <option key={option} value={option}>
                                {option.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                        ) : question.id === "notes" ? (
                          <textarea
                            value={value == null ? "" : String(value)}
                            onChange={(event) => update(event.target.value)}
                            rows={2}
                            className={`mt-1 min-h-20 w-full resize-y rounded-xl border bg-white/55 px-3 py-2 text-[13px] outline-none ${
                              issue ? "border-[var(--danger)]" : "border-white/60"
                            }`}
                          />
                        ) : (
                          <input
                            type={question.type === "number" ? "number" : "text"}
                            value={value == null ? "" : String(value)}
                            onChange={(event) => update(event.target.value)}
                            className={`mt-1 h-11 w-full rounded-xl border bg-white/55 px-3 text-[13px] outline-none ${
                              issue ? "border-[var(--danger)]" : "border-white/60"
                            }`}
                          />
                        )}
                        {issue && (
                          <span className="mt-1 block text-[11px] text-[var(--danger)]">
                            {issue}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void confirmAndStart()}
                    disabled={busy}
                    className="btn-send"
                  >
                    {busy ? "Checking…" : "Confirm & start 3 live agents"}
                  </button>
                </div>
              </div>
            )}

            {(status || error) && !showResults && (
              <div className="mt-4 w-full text-center text-[13px]">
                {error && <p className="text-[var(--danger)]">{error}</p>}
                {!error && status && (
                  <p className="flex items-center justify-center gap-2 text-[var(--ink-secondary)]">
                    {(busy || talkOpen) && <span className="pulse-dot" />}
                    {status}
                  </p>
                )}
              </div>
            )}

            {!showResults && recentRuns.length > 0 && (
              <details className="mt-4 w-full text-left">
                <summary className="cursor-pointer text-[12px] font-medium text-[var(--ink-muted)]">
                  Recent anonymous runs ({recentRuns.length})
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {recentRuns.map((run) => (
                    <button
                      key={run.job_id}
                      type="button"
                      onClick={() => void openRecentRun(run)}
                      className="glass-inner p-3 text-left"
                    >
                      <span className="block truncate text-[12px] font-medium">
                        {run.summary}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[var(--ink-muted)]">
                        {run.status} · {new Date(run.created_at).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </section>

          {/* Progressive status strip — green bar tracks live agent work */}
          {showResults && (
            <div className="mb-5 stage-enter">
              <StatusStrip active={statusStep} progress={progressPct} />
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
                zip={discoveryZip || " "}
                location={discoveryLocation || prompt}
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
                      audioUrl={session?.audio_url}
                      sessionId={session?.session_id}
                    />
                  );
                })}
              </div>
              <Top3Map
                vertical={vertical.id}
                zip={discoveryZip || undefined}
                location={discoveryLocation || prompt}
                geo={discoveryGeo}
              />
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
                {dealReady && (
                  <div className="flex flex-wrap items-center gap-3">
                    {hasExportableDeal && (
                      <button
                        type="button"
                        onClick={exportReport}
                        className="link-cta shrink-0 text-[13px] font-semibold"
                      >
                        Export PDF →
                      </button>
                    )}
                    {state?.job_id && (
                      <a
                        href={`/api/jobs/${state.job_id}/evidence`}
                        download
                        className="link-cta shrink-0 text-[13px] font-semibold"
                      >
                        Evidence bundle ↓
                      </a>
                    )}
                  </div>
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
                        ? `Your deal: ${top.session.vendor_name}${
                            top.session.current_price != null
                              ? ` at ${formatUsd(top.session.current_price)}`
                              : ""
                          }`
                        : "Your deal")}
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
                          {r.leverage_chain?.length ? (
                            <div className="mt-2 border-t border-black/5 pt-1.5">
                              {r.leverage_chain.slice(-2).map((step, index) => {
                                const seconds = Math.round(step.t_ms / 1000);
                                return (
                                  <button
                                    key={`${step.kind}-${step.t_ms}-${index}`}
                                    type="button"
                                    className="block w-full truncate text-left text-[10px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
                                    title={step.label}
                                    onClick={() =>
                                      document
                                        .getElementById(
                                          `transcript-${r.session.session_id}-${seconds}`,
                                        )
                                        ?.scrollIntoView({ behavior: "smooth", block: "center" })
                                    }
                                  >
                                    Evidence {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {step.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {state?.questions_before_booking?.length ? (
                    <div className="glass-inner p-3.5 text-left">
                      <p className="label-section">Questions before booking</p>
                      <ul className="mt-2 space-y-1.5 text-[13px] text-[var(--ink-secondary)]">
                        {state.questions_before_booking.map((question) => (
                          <li key={question.id} className="flex gap-2">
                            <span aria-hidden>·</span>
                            <span>{question.question}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {state?.booking_request_draft && (
                    <div className="glass-inner p-3.5 text-left">
                      <div className="flex items-center justify-between gap-3">
                        <p className="label-section">Human handoff draft</p>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          onClick={() => {
                            void navigator.clipboard.writeText(
                              state.booking_request_draft || "",
                            );
                            setCopiedDraft(true);
                            window.setTimeout(() => setCopiedDraft(false), 1500);
                          }}
                        >
                          {copiedDraft ? "Copied" : "Copy draft"}
                        </button>
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-[var(--ink-secondary)]">
                        {state.booking_request_draft}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {dealReady && vertical && (
                <div className="mt-5">
                  <LearningPanel vertical={vertical.id} jobId={state?.job_id} />
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

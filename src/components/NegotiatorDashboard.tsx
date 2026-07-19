"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { JobColumn } from "./JobColumn";
import { CallsColumn } from "./CallsColumn";
import { DealColumn } from "./DealColumn";
import { DiscoveryPanel } from "./DiscoveryPanel";
import { LearningPanel } from "./LearningPanel";
import {
  emptySessions,
  initialJobState,
  loadGoldenRun,
  normalizeApiState,
  playMockStream,
  rankSessions,
  resolveGoldenEvents,
  type StreamHandle,
} from "@/lib/ui/mockStream";
import type {
  JobSpec,
  JobState,
  MockEvent,
  VerticalConfig,
} from "@/lib/ui/types";
import { demoJobSpec, verticalTitle } from "@/lib/ui/types";

const POLL_MS = 800;

const VERTICALS = [
  { id: "hvac", label: "HVAC" },
  { id: "movers", label: "Movers" },
  { id: "medical-imaging", label: "MRI Imaging" },
  { id: "auto-repair", label: "Auto Repair" },
] as const;

export function NegotiatorDashboard() {
  const searchParams = useSearchParams();
  const verticalId = (searchParams.get("vertical") || "hvac").toLowerCase();
  const replayParam = searchParams.get("replay");
  const replay =
    replayParam === "true" ||
    replayParam === "live" ||
    replayParam === "1";
  const replayLive = replayParam === "live";

  const switchVertical = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("vertical", id);
    window.location.href = url.toString();
  };

  const [vertical, setVertical] = useState<VerticalConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<{
    vendor_id: string;
    ts: number;
  } | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const streamRef = useRef<StreamHandle | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayStarted = useRef(false);
  const verticalRef = useRef<VerticalConfig | null>(null);

  const voiceAgentId =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID || null
      : null;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startMock = useCallback(
    (cfg: VerticalConfig, job_spec: JobSpec, events?: MockEvent[]) => {
      streamRef.current?.stop();
      stopPolling();
      setBusy(true);
      setShowDiscovery(false);
      setBanner(replay ? "Golden replay running…" : "Live simulation running…");

      // Immediate UI feedback — never leave buttons stuck on "Confirmed"
      setState({
        job_id: `mock-${Date.now()}`,
        phase: "calling",
        job_spec,
        sessions: emptySessions(cfg),
        ranked: [],
      });

      void (async () => {
        try {
          let evs = events;
          let spec = job_spec;
          if (!evs) {
            const golden = await loadGoldenRun(
              cfg.id,
              replayLive ? "live" : "default",
            );
            evs = resolveGoldenEvents(golden);
            if (!spec || !Object.keys(spec).length) {
              spec = (golden?.job_spec as JobSpec) || job_spec;
            }
          }
          if (!evs?.length) {
            evs = resolveGoldenEvents(null);
          }

          streamRef.current = playMockStream(
            evs,
            cfg,
            (next) => {
              setState(next);
              if (next.phase === "complete") {
                setBusy(false);
                setBanner(null);
              }
            },
            { speed: 1.6, job_spec: spec },
          );
        } catch {
          // Never leave Confirm/busy stuck if golden load fails mid-flight
          setBusy(false);
          setBanner("Stream failed — retry Confirm or open ?replay=true");
          setState((prev) =>
            prev
              ? { ...prev, phase: "draft" }
              : initialJobState(cfg),
          );
        }
      })();
    },
    [stopPolling, replayLive, replay],
  );

  const startPolling = useCallback(
    (jobId: string, cfg: VerticalConfig) => {
      stopPolling();
      const startedAt = Date.now();
      let lastRekickAt = 0;
      const tick = async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}/state`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const raw = await res.json();
          const normalized = normalizeApiState(raw, cfg);
          if (!normalized) return;
          setState(normalized);
          if (normalized.phase === "complete") {
            stopPolling();
            setBusy(false);
            setBanner("Negotiations complete — ranked deals ready");
            setTimeout(() => setBanner(null), 4000);
            return;
          }
          // If serverless simulate was killed mid-run, re-POST start to resume
          // remaining tracks (server is idempotent / per-session).
          const elapsed = Date.now() - startedAt;
          const sinceRekick = Date.now() - lastRekickAt;
          if (
            elapsed > 14_000 &&
            sinceRekick > 14_000 &&
            normalized.phase === "calling"
          ) {
            lastRekickAt = Date.now();
            void fetch("/api/sessions/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                job_id: jobId,
                live: false,
                simulate: true,
              }),
            }).catch(() => {
              /* ignore */
            });
          }
        } catch {
          /* keep polling */
        }
      };
      void tick(); // immediate first paint
      pollRef.current = setInterval(() => void tick(), POLL_MS);
    },
    [stopPolling],
  );

  // Load vertical config
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setVertical(null);
    setState(null);
    setShowDiscovery(false);
    setBanner(null);
    setBusy(false);
    replayStarted.current = false;
    streamRef.current?.stop();
    stopPolling();

    (async () => {
      try {
        const res = await fetch(`/api/vertical?id=${verticalId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Vertical ${verticalId} not found`);
        const cfg = (await res.json()) as VerticalConfig;
        if (cancelled) return;
        verticalRef.current = cfg;
        setVertical(cfg);
        setState(initialJobState(cfg));
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load vertical",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.stop();
      stopPolling();
    };
  }, [verticalId, stopPolling]);

  /**
   * Auto-start golden replay.
   * CRITICAL:
   * - Mark replayStarted only AFTER startMock (Strict Mode cleanup used to
   *   cancel the first async load while leaving started=true → dead UI).
   * - Do not setTimeout after phase transitions; startMock sets calling now.
   * - Depend on phase/job_spec primitives, not full state object.
   */
  useEffect(() => {
    if (!vertical || !replay) return;
    if (replayStarted.current) return;
    if (!state) return;
    // Wait until initial draft state exists, then start once
    if (state.phase !== "draft" || state.job_spec) return;

    let cancelled = false;

    (async () => {
      try {
        const golden = await loadGoldenRun(
          vertical.id,
          replayLive ? "live" : "default",
        );
        if (cancelled || replayStarted.current) return;
        const spec =
          (golden?.job_spec as JobSpec) || demoJobSpec(vertical);
        const events = resolveGoldenEvents(golden);
        replayStarted.current = true;
        // startMock sets calling immediately — no fragile setTimeout
        startMock(vertical, spec, events);
      } catch {
        if (cancelled || replayStarted.current) return;
        replayStarted.current = true;
        startMock(vertical, demoJobSpec(vertical));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    vertical,
    replay,
    replayLive,
    startMock,
    state?.phase,
    // Only gate on "has any job_spec keys" so object identity churn doesn't re-fire
    state?.job_spec ? 1 : 0,
  ]);

  const onJobSpecChange = useCallback((spec: JobSpec) => {
    setState((prev) =>
      prev ? { ...prev, job_spec: spec, phase: "draft" } : prev,
    );
  }, []);

  const startSessions = useCallback(
    async (jobId: string, spec: JobSpec) => {
      if (!vertical) return;
      setBusy(true);
      setBanner("Starting negotiations…");
      try {
        // Prefer live agent-vs-agent; server falls back to simulate if not configured.
        // Force simulate with ?simulate=1; force live with ?live=1
        const forceSim = searchParams.get("simulate") === "1";
        const forceLive = searchParams.get("live") === "1";
        const startRes = await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: jobId,
            ...(forceSim
              ? { simulate: true, live: false }
              : forceLive
                ? { live: true }
                : {}),
          }),
        });
        if (!startRes.ok) {
          const err = await startRes.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error || "start failed",
          );
        }
        const body = (await startRes.json()) as {
          sessions?: unknown[];
          live?: boolean;
          status?: string;
          simulate?: boolean;
        };

        setShowDiscovery(false);
        setState({
          job_id: jobId,
          phase: "calling",
          job_spec: spec,
          sessions: emptySessions(vertical),
          ranked: [],
        });
        setBanner(
          body.live
            ? "Live ElevenLabs agent bridges running — transcripts stream into Neon…"
            : body.simulate
              ? "Live negotiations running (server) — quotes & transcripts writing to Neon…"
              : "Sessions started — polling for updates…",
        );
        startPolling(jobId, vertical);
      } catch (e) {
        setShowDiscovery(false);
        setBanner(
          e instanceof Error
            ? `${e.message} — falling back to client stream`
            : "Falling back to client stream",
        );
        startMock(vertical, spec);
      }
    },
    [vertical, startPolling, startMock, searchParams],
  );

  const onConfirm = useCallback(async () => {
    if (!vertical || !state?.job_spec) return;
    setBusy(true);
    streamRef.current?.stop();
    stopPolling();

    // Replay mode: pure client golden stream
    if (replay) {
      startMock(vertical, state.job_spec);
      return;
    }

    try {
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical: vertical.id,
          job_spec: state.job_spec,
        }),
      });
      if (!createRes.ok) throw new Error("Could not create job");

      const created = (await createRes.json()) as {
        job?: { id: string };
        id?: string;
        job_id?: string;
      };
      const jobId = created.job?.id || created.job_id || created.id;
      if (!jobId) throw new Error("No job id returned");

      const confirmRes = await fetch(`/api/jobs/${jobId}/confirm`, {
        method: "PATCH",
      });
      if (!confirmRes.ok) throw new Error("Could not confirm job");

      setState((prev) =>
        prev
          ? {
              ...prev,
              job_id: jobId,
              phase: "confirmed",
              job_spec: state.job_spec,
            }
          : prev,
      );
      setShowDiscovery(true);
      setBusy(false);
      setBanner("Pick providers, then start negotiations");
    } catch (e) {
      setBanner(
        e instanceof Error
          ? `${e.message} — using offline simulation`
          : "Using offline simulation",
      );
      startMock(vertical, state.job_spec);
    }
  }, [vertical, state?.job_spec, replay, startMock, stopPolling]);

  const onListen = useCallback((vendor_id: string, ts: number) => {
    setHighlight({ vendor_id, ts });
    requestAnimationFrame(() => {
      document.getElementById(`ts-${ts}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    setTimeout(() => setHighlight(null), 2500);
  }, []);

  if (loadError) {
    return (
      <div className="ambient-root flex min-h-screen items-center justify-center p-8">
        <div className="ambient-bg" aria-hidden>
          <div className="ambient-orb ambient-orb-1" />
          <div className="ambient-orb ambient-orb-2" />
        </div>
        <p className="ambient-content glass-panel px-6 py-4 text-sm text-[#9f3a2a]">
          {loadError}
        </p>
      </div>
    );
  }

  if (!vertical || !state) {
    return (
      <div className="ambient-root flex min-h-screen items-center justify-center p-8">
        <div className="ambient-bg" aria-hidden>
          <div className="ambient-orb ambient-orb-1" />
          <div className="ambient-orb ambient-orb-2" />
          <div className="ambient-orb ambient-orb-3" />
        </div>
        <p className="ambient-content glass-panel px-6 py-4 text-sm text-[var(--glass-text-secondary)]">
          Loading agents…
        </p>
      </div>
    );
  }

  const jobType =
    (state.job_spec?.job_type as string) ||
    (state.job_spec?.job_kind as string) ||
    vertical.default_job_type ||
    null;

  const ranked =
    state.phase === "complete" && state.ranked.length === 0
      ? rankSessions(state.sessions, vertical, jobType)
      : state.ranked;

  const isWorking = state.phase === "calling" || busy;
  const liveAgents = state.sessions.filter(
    (s) => s.status === "dialing" || s.status === "negotiating",
  ).length;

  return (
    <div
      className={`ambient-root flex min-h-screen flex-col text-[var(--glass-text)] ${
        isWorking ? "is-working" : ""
      }`}
    >
      <div className="ambient-bg" aria-hidden>
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-orb ambient-orb-3" />
        <div className="ambient-mesh" />
      </div>

      <div className="ambient-content flex min-h-screen flex-col">
        <header className="glass-header sticky top-0 z-20 shrink-0">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="audio-sphere shrink-0" aria-hidden />
              <div className="min-w-0">
                <h1 className="font-display text-[20px] leading-none tracking-[-0.02em] text-white">
                  LeverageAI
                </h1>
                <p className="mt-0.5 truncate text-[12px] text-white/60">
                  {verticalTitle(vertical)}
                  {replayLive
                    ? " · live-run replay"
                    : replay
                      ? " · golden replay"
                      : " · multi-agent"}
                </p>
              </div>
              <div className="ml-2 hidden flex-wrap gap-1.5 sm:ml-4 sm:flex">
                {VERTICALS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => switchVertical(v.id)}
                    className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                      verticalId === v.id
                        ? "border-white/50 bg-white/90 text-[#0c0b0a]"
                        : "border-white/20 bg-white/10 text-white/80 hover:bg-white/18"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            <PhasePill phase={state.phase} />
          </div>

          {isWorking && (
            <div className="agent-activity" role="status" aria-live="polite">
              <span className="agent-activity-dot" />
              <span className="agent-activity-dot" />
              <span className="agent-activity-dot" />
              <span>
                {liveAgents > 0
                  ? `${liveAgents} agent${liveAgents === 1 ? "" : "s"} negotiating in parallel`
                  : "Agents connecting — multi-agent orchestration running"}
              </span>
            </div>
          )}

          {banner && !isWorking && (
            <div className="border-t border-white/10 bg-white/[0.06] px-6 py-2 text-center text-[12px] text-white/75">
              {banner}
            </div>
          )}
        </header>

        <main className="mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-3 lg:gap-4 lg:min-h-0 lg:overflow-hidden">
          <div className="glass-panel flex min-h-0 flex-col overflow-hidden p-4 sm:p-5 lg:h-[calc(100vh-6.5rem)]">
            <div className="min-h-0 flex-1 space-y-4 overflow-auto">
              <JobColumn
                vertical={vertical}
                phase={state.phase}
                jobSpec={state.job_spec}
                onJobSpecChange={onJobSpecChange}
                onConfirm={onConfirm}
                voiceAgentId={voiceAgentId}
                busy={busy}
              />
              {showDiscovery && state.job_id && state.job_spec && (
                <DiscoveryPanel
                  vertical={vertical}
                  zip={String(state.job_spec.zip || "28202")}
                  busy={busy}
                  onContinue={() =>
                    startSessions(state.job_id!, state.job_spec as JobSpec)
                  }
                />
              )}
              <LearningPanel vertical={vertical.id} />
            </div>
          </div>

          <div
            className={`glass-panel flex min-h-0 flex-col overflow-hidden p-4 sm:p-5 lg:h-[calc(100vh-6.5rem)] ${
              isWorking ? "glass-working" : ""
            }`}
          >
            <CallsColumn
              vertical={vertical}
              sessions={state.sessions}
              highlight={highlight}
              onHighlightClear={() => setHighlight(null)}
            />
          </div>

          <div className="glass-panel flex min-h-0 flex-col overflow-hidden p-4 sm:p-5 lg:h-[calc(100vh-6.5rem)]">
            <DealColumn
              vertical={vertical}
              phase={state.phase}
              ranked={ranked}
              sessions={state.sessions}
              onListen={onListen}
              replay={replay}
              jobSpec={state.job_spec}
              dealReview={state.deal_review}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function PhasePill({ phase }: { phase: string }) {
  const label =
    phase === "draft"
      ? "Draft job"
      : phase === "confirmed"
        ? "Confirmed"
        : phase === "calling"
          ? "Agents live"
          : "Deal ready";
  const active = phase === "complete" || phase === "calling";
  return (
    <span
      className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium ${
        active
          ? "border-white/40 bg-white/90 text-[#0c0b0a]"
          : "border-white/20 bg-white/10 text-white/70"
      }`}
    >
      {label}
    </span>
  );
}

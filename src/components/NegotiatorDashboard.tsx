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

const POLL_MS = 1000;

export function NegotiatorDashboard() {
  const searchParams = useSearchParams();
  const verticalId = (searchParams.get("vertical") || "hvac").toLowerCase();
  const replayParam = searchParams.get("replay");
  const replay =
    replayParam === "true" ||
    replayParam === "live" ||
    replayParam === "1";
  const replayLive = replayParam === "live";

  const VERTICALS = [
    { id: "hvac", label: "HVAC" },
    { id: "movers", label: "Movers" },
    { id: "medical-imaging", label: "MRI Imaging" },
    { id: "auto-repair", label: "Auto Repair" },
  ] as const;

  const switchVertical = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("vertical", id);
    // keep replay if present
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

  const streamRef = useRef<StreamHandle | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayStarted = useRef(false);

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

      void (async () => {
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

        streamRef.current = playMockStream(
          evs,
          cfg,
          (next) => {
            setState(next);
            if (next.phase === "complete") setBusy(false);
          },
          { speed: 1.8, job_spec: spec },
        );
      })();
    },
    [stopPolling, replayLive],
  );

  const startPolling = useCallback(
    (jobId: string, cfg: VerticalConfig) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
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
          }
        } catch {
          /* keep polling */
        }
      }, POLL_MS);
    },
    [stopPolling],
  );

  // Load vertical config
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setVertical(null);
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

  // Auto-start golden replay
  useEffect(() => {
    if (!vertical || !state || !replay) return;
    if (replayStarted.current) return;
    if (state.phase !== "draft") return;
    replayStarted.current = true;

    let cancelled = false;
    (async () => {
      const golden = await loadGoldenRun(vertical.id);
      if (cancelled) return;
      const spec =
        (golden?.job_spec as JobSpec) || demoJobSpec(vertical);
      setState((prev) =>
        prev ? { ...prev, job_spec: spec, phase: "confirmed" } : prev,
      );
      setTimeout(() => {
        if (!cancelled) {
          startMock(vertical, spec, resolveGoldenEvents(golden));
        }
      }, 250);
    })();

    return () => {
      cancelled = true;
    };
  }, [vertical, state, replay, startMock]);

  const onJobSpecChange = useCallback((spec: JobSpec) => {
    setState((prev) =>
      prev ? { ...prev, job_spec: spec, phase: "draft" } : prev,
    );
  }, []);

  const startSessions = useCallback(
    async (jobId: string, spec: JobSpec) => {
      if (!vertical) return;
      setBusy(true);
      try {
        const startRes = await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId }),
        });
        if (!startRes.ok) throw new Error("start failed");

        setShowDiscovery(false);
        setState({
          job_id: jobId,
          phase: "calling",
          job_spec: spec,
          sessions: emptySessions(vertical),
          ranked: [],
        });
        startPolling(jobId, vertical);
      } catch {
        setShowDiscovery(false);
        startMock(vertical, spec);
      }
    },
    [vertical, startPolling, startMock],
  );

  const onConfirm = useCallback(async () => {
    if (!vertical || !state?.job_spec) return;
    setBusy(true);
    streamRef.current?.stop();
    stopPolling();

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
      if (!createRes.ok) throw new Error("jobs create failed");

      const created = (await createRes.json()) as {
        job?: { id: string };
        id?: string;
        job_id?: string;
      };
      const jobId = created.job?.id || created.job_id || created.id;
      if (!jobId) throw new Error("no job id");

      const confirmRes = await fetch(`/api/jobs/${jobId}/confirm`, {
        method: "PATCH",
      });
      if (!confirmRes.ok) throw new Error("confirm failed");

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
    } catch {
      startMock(vertical, state.job_spec);
    }
  }, [
    vertical,
    state?.job_spec,
    replay,
    startMock,
    stopPolling,
  ]);

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
        <p className="text-sm text-rose-600">{loadError}</p>
      </div>
    );
  }

  if (!vertical || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8">
        <p className="text-sm text-slate-500">Loading…</p>
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

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              L
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                LeverageAI
              </h1>
              <p className="text-xs text-slate-500">
                {verticalTitle(vertical)}
                {replayLive
                  ? " · live-run replay"
                  : replay
                    ? " · golden replay"
                    : ""}
              </p>
            </div>
            <div className="ml-4 flex flex-wrap gap-1">
              {VERTICALS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => switchVertical(v.id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    verticalId === v.id
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/architecture"
              className="text-[11px] font-medium text-slate-500 hover:text-emerald-700"
            >
              Architecture
            </a>
            <PhasePill phase={state.phase} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3 lg:gap-5 lg:min-h-0 lg:overflow-hidden">
        <div className="min-h-0 space-y-4 lg:h-[calc(100vh-5.5rem)] lg:overflow-auto">
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
        <div className="min-h-0 lg:h-[calc(100vh-5.5rem)]">
          <CallsColumn
            vertical={vertical}
            sessions={state.sessions}
            highlight={highlight}
            onHighlightClear={() => setHighlight(null)}
          />
        </div>
        <div className="min-h-0 lg:h-[calc(100vh-5.5rem)]">
          <DealColumn
            vertical={vertical}
            phase={state.phase}
            ranked={ranked}
            sessions={state.sessions}
            onListen={onListen}
            replay={replay}
            jobSpec={state.job_spec}
          />
        </div>
      </main>
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
          ? "Live calls"
          : "Deal ready";
  const color =
    phase === "complete"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : phase === "calling"
        ? "bg-sky-50 text-sky-800 ring-sky-200"
        : "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${color}`}
    >
      {label}
    </span>
  );
}

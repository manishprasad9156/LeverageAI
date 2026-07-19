import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { getStore } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/db/pool";
import {
  loadVertical,
  toPublicVertical,
} from "@/lib/config/loadVertical";
import { publish } from "@/lib/db/events";
import { isLiveModeEnabled } from "@/lib/elevenlabs/liveMode";
import { getAgentId } from "@/lib/elevenlabs/env";
import { runBridgesParallel } from "@/lib/elevenlabs/bridge";
import type { BridgePairIntent } from "@/lib/elevenlabs/types";
import { fetchAndStoreRecording } from "@/lib/elevenlabs/recordings";
import { simulateJobNegotiations } from "@/lib/sessions/simulateNegotiation";
import {
  onSessionsStarted,
  onReportReady,
} from "@/lib/orchestrator/runtime";
import {
  selectTacticsUcb,
  formatPlaybookForAgent,
} from "@/lib/learning/bandit";

export const runtime = "nodejs";
/**
 * Vercel Hobby max is 300s; Pro/Fluid can raise further.
 * Background bridges / simulate use waitUntil — return is still instant.
 */
export const maxDuration = 300;

const schema = z.object({
  job_id: z.string().uuid(),
  /** True = ElevenLabs agent bridges (requires keys + DATABASE_URL). */
  live: z.boolean().optional(),
  /**
   * True = server-side scripted negotiation writing real DB rows (default when
   * live is not requested). Always works with Neon; best for live demos.
   */
  simulate: z.boolean().optional(),
});

function scheduleBackground(work: () => Promise<void>): void {
  const promise = work().catch((e) =>
    console.error("[sessions/start background]", e)
  );
  try {
    waitUntil(promise);
    return;
  } catch {
    /* not on Vercel */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as {
      after?: (fn: () => void | Promise<void>) => void;
    };
    if (typeof after === "function") {
      after(() => promise);
      return;
    }
  } catch {
    /* no after */
  }
  void promise;
}

/**
 * POST /api/sessions/start
 *
 * Modes:
 * - simulate (default): background script writes transcripts/quotes; UI polls.
 * - live=true: ElevenLabs text bridges (only if all agent env vars present).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 }
      );
    }

    const store = getStore();
    const job = await store.getJob(parsed.data.job_id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (!job.confirmed) {
      return NextResponse.json(
        { error: "Job must be confirmed before starting sessions" },
        { status: 400 }
      );
    }

    // Judges path: prefer real ElevenLabs agent-vs-agent when configured.
    // simulate=true forces server script; live=false also forces simulate.
    // Default (no flags): live if available, else simulate.
    const liveAvailable = isLiveModeEnabled();
    const forceSimulate = parsed.data.simulate === true;
    const liveRequested =
      !forceSimulate &&
      (parsed.data.live === true || parsed.data.live === undefined);
    let wantLive = liveRequested && liveAvailable && !forceSimulate;
    let wantSimulate = !wantLive;

    // Serverless: both modes need shared Postgres so polling sees writes.
    if ((wantLive || wantSimulate) && !hasDatabaseUrl()) {
      return NextResponse.json(
        {
          error:
            "Live/simulate mode requires Postgres — in-memory store breaks across serverless instances. Set DATABASE_URL (Neon).",
          code: "DATABASE_REQUIRED_FOR_LIVE",
        },
        { status: 400 }
      );
    }

    if (liveRequested && !liveAvailable) {
      // Fall through to simulate with a clear flag
      wantLive = false;
      wantSimulate = true;
    }

    const existing = await store.listSessionsByJob(job.id);
    if (existing.length > 0) {
      const allDone =
        job.status === "complete" ||
        existing.every(
          (s) =>
            s.status === "closed" ||
            s.status === "error" ||
            s.outcome_type != null
        );
      // Re-kick stuck / never-started / partial (timeout) simulate runs.
      // Skip only when a track looks freshly active (avoid double-parallel races).
      const STALE_MS = 12_000;
      const recentlyActive = existing.some((s) => {
        if (s.outcome_type != null) return false;
        if (s.status !== "live" && s.status !== "connecting") return false;
        if (!s.last_event_at) return true; // just flipped to connecting
        return Date.now() - new Date(s.last_event_at).getTime() < STALE_MS;
      });
      const needsSimulateResume =
        wantSimulate &&
        !wantLive &&
        !allDone &&
        !recentlyActive &&
        (job.status === "running" ||
          job.status === "confirmed" ||
          job.confirmed);
      if (needsSimulateResume) {
        const jobId = job.id;
        if (job.status !== "running") {
          await store.updateJob(jobId, { status: "running" });
        }
        scheduleBackground(async () => {
          console.log(`[sessions/start] re-kick/resume simulate job=${jobId}`);
          await simulateJobNegotiations(jobId);
        });
      }
      return NextResponse.json({
        sessions: existing,
        already_started: true,
        job_id: job.id,
        live: wantLive,
        simulate: wantSimulate && !wantLive,
        status: allDone
          ? "complete"
          : existing.some(
                (s) => s.status === "live" || s.status === "connecting"
              ) || needsSimulateResume
            ? wantLive
              ? "bridging"
              : "simulating"
            : "ready",
        live_mode_available: liveAvailable,
        note:
          liveRequested && !liveAvailable
            ? "ElevenLabs agents not fully configured — using server simulate"
            : undefined,
      });
    }

    let vertical;
    try {
      vertical = loadVertical(job.vertical);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Vertical error" },
        { status: 400 }
      );
    }

    const frozen = job.frozen_job_spec ?? job.job_spec;
    const jobSpecJson = JSON.stringify(frozen);

    // Create as connecting immediately so concurrent POSTs see in-flight
    // sessions and do not spawn a second full vendor set / double-simulate.
    const sessions = [];
    for (const vendor of vertical.vendors) {
      const session = await store.createSession({
        job_id: job.id,
        vendor_id: vendor.id,
        vendor_name: vendor.name ?? vendor.displayName,
        status: "connecting",
      });
      sessions.push(session);
      publish({
        type: "session",
        job_id: job.id,
        session_id: session.id,
        payload: session,
      });
    }

    await store.updateJob(job.id, { status: "running" });
    try {
      onSessionsStarted(job.id, sessions.length);
    } catch (e) {
      console.warn("[sessions/start] xstate", e);
    }

    // UCB1 playbook → inject into live agent dynamic vars
    let playbookHint = "";
    try {
      const selected = await selectTacticsUcb(job.vertical, 3);
      playbookHint = formatPlaybookForAgent(selected.sentences);
    } catch (e) {
      console.warn("[sessions/start] bandit playbook", e);
    }

    if (wantLive) {
      const intents: BridgePairIntent[] = sessions.map((s) => {
        const slot = s.vendor_id as "tough" | "stonewaller" | "upseller";
        return {
          negotiatorAgentId: getAgentId("negotiator"),
          counterAgentId: getAgentId(slot),
          companyKey: slot,
          jobId: job.id,
          sessionId: s.id,
          jobSpecJson,
          playbookHint,
        };
      });

      const jobId = job.id;
      scheduleBackground(async () => {
        console.log(
          `[sessions/start] parallel multi-agent bridges job=${jobId} n=${intents.length}`
        );
        try {
          const results = await runBridgesParallel(intents);
          console.log(
            `[sessions/start] bridges done (parallel)`,
            results.map((r) => ({ id: r.sessionId, ok: r.ok, err: r.error }))
          );

          for (const r of results) {
            if (!r.ok) {
              publish({
                type: "session",
                job_id: jobId,
                session_id: r.sessionId,
                payload: {
                  status: "error",
                  event: "session_error",
                  reason: "bridge_error",
                  error: r.error,
                },
              });
              const storeE = getStore();
              const sess = await storeE.getSession(r.sessionId);
              if (sess && !sess.outcome_type) {
                await storeE.closeSession(
                  r.sessionId,
                  "documented_decline",
                  `bridge_error: ${r.error || "unknown"}`
                );
              }
            }
          }

          const store2 = getStore();
          for (const s of await store2.listSessionsByJob(jobId)) {
            if (s.negotiator_conversation_id) {
              await fetchAndStoreRecording(
                s.id,
                s.negotiator_conversation_id
              ).catch((e) =>
                console.warn("[sessions/start] recording", s.id, e)
              );
            }
          }

          const finalSessions = await store2.listSessionsByJob(jobId);
          const allDone = finalSessions.every(
            (s) =>
              s.status === "closed" ||
              s.status === "error" ||
              s.outcome_type != null
          );
          if (allDone) {
            await store2.updateJob(jobId, { status: "complete" });
            try {
              onReportReady(jobId);
            } catch {
              /* ignore */
            }
            publish({
              type: "job",
              job_id: jobId,
              payload: { status: "complete" },
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[sessions/start] bridge fatal", msg);
          const storeE = getStore();
          for (const s of await storeE.listSessionsByJob(jobId)) {
            publish({
              type: "session",
              job_id: jobId,
              session_id: s.id,
              payload: {
                event: "session_error",
                reason: "bridge_error",
                error: msg,
              },
            });
            if (!s.outcome_type) {
              await storeE.closeSession(
                s.id,
                "documented_decline",
                `bridge_error: ${msg}`
              );
            }
          }
          await storeE.updateJob(jobId, { status: "complete" });
          publish({
            type: "job",
            job_id: jobId,
            payload: { status: "complete" },
          });
        }
      });
    } else if (wantSimulate) {
      const jobId = job.id;
      scheduleBackground(async () => {
        console.log(`[sessions/start] background simulate job=${jobId}`);
        try {
          await simulateJobNegotiations(jobId);
          try {
            onReportReady(jobId);
          } catch {
            /* ignore */
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[sessions/start] simulate fatal", msg);
          const storeE = getStore();
          for (const s of await storeE.listSessionsByJob(jobId)) {
            if (!s.outcome_type) {
              await storeE.closeSession(
                s.id,
                "documented_decline",
                `simulate_error: ${msg}`
              );
            }
          }
          await storeE.updateJob(jobId, { status: "complete" });
        }
      });
    }

    const pub = toPublicVertical(vertical);
    const latest = await store.listSessionsByJob(job.id);

    return NextResponse.json(
      {
        job_id: job.id,
        sessions: latest,
        live: wantLive,
        simulate: wantSimulate && !wantLive,
        status: wantLive
          ? "bridging"
          : wantSimulate
            ? "simulating"
            : "ready",
        bridge_async: wantLive,
        simulate_async: wantSimulate && !wantLive,
        live_mode_available: liveAvailable,
        note:
          liveRequested && !liveAvailable
            ? "ElevenLabs agents not fully configured — using server simulate"
            : undefined,
        vendors: pub.vendors.map((v) => ({
          id: v.id,
          name: v.name ?? v.displayName,
          displayName: v.displayName,
          persona: v.persona ?? v.role,
          role: v.role,
          role_label: v.role_label,
          public_blurb: v.public_blurb,
        })),
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("[POST /api/sessions/start]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

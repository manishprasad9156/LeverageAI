import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { publish } from "@/lib/db/events";
import { onSpecConfirmed } from "@/lib/orchestrator/runtime";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/jobs/[id]/confirm — lock confirmed=true; job_spec immutable after
 */
export async function PATCH(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const store = getStore();
    const existing = await store.getJob(id);
    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (existing.confirmed) {
      return NextResponse.json({ job: existing, already_confirmed: true });
    }

    if (!existing.job_spec?.job_type && !existing.job_spec?.job_kind) {
      return NextResponse.json(
        {
          error:
            "Cannot confirm job without job_spec.job_type or job_spec.job_kind",
        },
        { status: 400 }
      );
    }

    const job = await store.confirmJob(id);
    if (!job) {
      return NextResponse.json({ error: "Confirm failed" }, { status: 500 });
    }

    try {
      onSpecConfirmed(job.id, job.vertical);
    } catch (e) {
      console.warn("[confirm] xstate", e);
    }

    publish({ type: "job", job_id: job.id, payload: job });
    return NextResponse.json({ job });
  } catch (e) {
    console.error("[PATCH /api/jobs/:id/confirm]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

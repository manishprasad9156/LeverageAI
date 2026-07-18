import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireToolWebhookAuth } from "@/lib/security/webhookAuth";
import {
  createIntakeDraft,
  fillIntakeDraft,
  fillLatestByVertical,
  getIntakeDraft,
} from "@/lib/intake/draftStore";
import type { JobSpec } from "@/lib/types";

/**
 * POST /api/tools/submit_spec
 * Called by the intake ElevenLabs agent (client or webhook tool).
 * Writes a filled draft the UI polls to populate the job form.
 */
const bodySchema = z
  .object({
    intake_id: z.string().uuid().optional(),
    vertical: z.string().optional(),
    confirmed: z.boolean().optional(),
    system_type: z.union([z.string(), z.null()]).optional(),
    tonnage: z.union([z.number(), z.null()]).optional(),
    sqft: z.union([z.number(), z.null()]).optional(),
    home_sqft: z.union([z.number(), z.null()]).optional(),
    symptom: z.union([z.string(), z.null()]).optional(),
    ductwork: z.union([z.string(), z.null()]).optional(),
    urgency: z.union([z.string(), z.null()]).optional(),
    zip: z.union([z.string(), z.null()]).optional(),
    notes: z.union([z.string(), z.null()]).optional(),
    job_type: z.union([z.string(), z.null()]).optional(),
    job_kind: z.union([z.string(), z.null()]).optional(),
    job_spec: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export async function POST(req: NextRequest) {
  const unauthorized = requireToolWebhookAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 }
      );
    }
    const b = parsed.data;
    const vertical = b.vertical || "hvac";

    const job_spec: JobSpec = {
      ...(b.job_spec || {}),
    };
    if (b.system_type != null) job_spec.system_type = b.system_type;
    if (b.tonnage != null) job_spec.tonnage = b.tonnage;
    if (b.home_sqft != null) job_spec.home_sqft = b.home_sqft;
    else if (b.sqft != null) job_spec.home_sqft = b.sqft;
    if (b.symptom != null) job_spec.symptom = b.symptom;
    if (b.ductwork != null) job_spec.ductwork = b.ductwork;
    if (b.urgency != null) job_spec.urgency = b.urgency;
    if (b.zip != null) job_spec.zip = b.zip;
    if (b.notes != null) job_spec.notes = b.notes;
    if (b.job_type != null) job_spec.job_type = b.job_type;
    if (b.job_kind != null) job_spec.job_kind = b.job_kind;
    if (!job_spec.job_type && !job_spec.job_kind) {
      job_spec.job_type = "ac_replacement_3ton";
      job_spec.job_kind = "ac_replacement_3ton";
    }

    let draft;
    if (b.intake_id) {
      draft = await fillIntakeDraft(b.intake_id, job_spec);
      if (!draft) {
        const created = await createIntakeDraft(vertical);
        draft = await fillIntakeDraft(created.id, job_spec);
      }
    } else {
      draft = await fillLatestByVertical(vertical, job_spec);
    }

    return NextResponse.json({
      ok: true,
      intake_id: draft?.id,
      job_spec,
      status: draft?.status,
      message:
        "Job spec saved. The LeverageAI form will pick this up automatically.",
    });
  } catch (e) {
    console.error("[submit_spec]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 }
    );
  }
}

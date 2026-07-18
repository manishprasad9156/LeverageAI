import { NextRequest, NextResponse } from "next/server";
import { createIntakeDraft } from "@/lib/intake/draftStore";
import { tryGetAgentId } from "@/lib/elevenlabs/env";
import {
  getConversationSignedUrl,
  normalizeSignedUrl,
} from "@/lib/elevenlabs/conversations";

/**
 * POST /api/intake/start
 * Creates a durable intake draft (Neon) the UI polls; returns talk URL.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const vertical =
      typeof body.vertical === "string" ? body.vertical : "hvac";
    const draft = await createIntakeDraft(vertical);
    const agentId = tryGetAgentId("intake");

    let signed_url: string | null = null;
    if (agentId && process.env.ELEVENLABS_API_KEY) {
      try {
        const raw = await getConversationSignedUrl(agentId);
        signed_url = normalizeSignedUrl(raw);
      } catch (e) {
        console.warn("[intake/start] signed url failed", e);
      }
    }

    return NextResponse.json({
      intake_id: draft.id,
      vertical,
      agent_id: agentId,
      signed_url,
      dynamic_variables: {
        intake_id: draft.id,
        vertical,
      },
      talk_url: agentId
        ? `https://elevenlabs.io/app/talk-to?agent_id=${encodeURIComponent(agentId)}`
        : null,
      poll_url: `/api/intake/status?intake_id=${draft.id}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

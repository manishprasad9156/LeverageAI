/**
 * Outbound PSTN via ElevenLabs native Twilio integration.
 * Docs to verify at implement time:
 * https://elevenlabs.io/docs/eleven-agents/phone-numbers
 * Outbound typically: POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
 * (path verified against live docs before production enable).
 *
 * TCPA: only call numbers you own or have consent for.
 * Default ENABLE_REAL_OUTBOUND=false.
 */
import { getElevenLabsApiKey } from "@/lib/elevenlabs/env";

export type OutboundRequest = {
  agentId: string;
  toNumber: string;
  fromNumber?: string;
  jobId?: string;
  sessionId?: string;
  dynamicVariables?: Record<string, string>;
};

export type OutboundResult =
  | { ok: true; callId?: string; raw?: unknown }
  | { ok: false; code: string; error: string };

export function realOutboundEnabled(): boolean {
  return (
    process.env.ENABLE_REAL_OUTBOUND === "true" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID) &&
    Boolean(process.env.TWILIO_AUTH_TOKEN) &&
    Boolean(process.env.TWILIO_PHONE_NUMBER || process.env.ELEVENLABS_PHONE_NUMBER_ID)
  );
}

/**
 * Place outbound call. Refuses unless ENABLE_REAL_OUTBOUND=true.
 * Demo mode: set OUTBOUND_DEMO_NUMBER to a number YOU own (teammate plays vendor).
 */
export async function placeOutboundCall(
  req: OutboundRequest
): Promise<OutboundResult> {
  if (!realOutboundEnabled()) {
    return {
      ok: false,
      code: "NOT_ENABLED",
      error:
        "ENABLE_REAL_OUTBOUND is false. Set TWILIO_* + ENABLE_REAL_OUTBOUND=true only with consent. See README TCPA warning.",
    };
  }

  const to = process.env.OUTBOUND_DEMO_NUMBER || req.toNumber;
  if (!to) {
    return { ok: false, code: "NO_NUMBER", error: "Missing destination number" };
  }

  try {
    const key = getElevenLabsApiKey();
    // Endpoint per ElevenLabs ConvAI Twilio outbound (verify in dashboard docs if 404)
    const res = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: req.agentId,
          agent_phone_number_id:
            process.env.ELEVENLABS_PHONE_NUMBER_ID || undefined,
          to_number: to,
          conversation_initiation_client_data: {
            dynamic_variables: {
              job_id: req.jobId,
              session_id: req.sessionId,
              ...req.dynamicVariables,
            },
          },
        }),
      }
    );
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        code: "API_ERROR",
        error: `outbound ${res.status}: ${JSON.stringify(raw).slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      callId:
        (raw as { conversation_id?: string; callSid?: string }).conversation_id ||
        (raw as { callSid?: string }).callSid,
      raw,
    };
  } catch (e) {
    return {
      ok: false,
      code: "NETWORK",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

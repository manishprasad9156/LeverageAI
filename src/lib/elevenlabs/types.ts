/**
 * Thin types for ElevenLabs Conversational AI REST helpers.
 * Not a full SDK — enough for conversation start + webhook stubs.
 */

import type { NegotiatorAgentSlot } from "./env";

export type { NegotiatorAgentSlot };

export interface ElevenLabsErrorBody {
  detail?: unknown;
  message?: string;
}

/** Dynamic variables injected when starting a conversation. */
export interface ConversationDynamicVariables {
  job_id?: string;
  session_id?: string;
  company_key?: string;
  company_name?: string;
  /** JSON-stringified confirmed job_spec for the negotiator. */
  job_spec_json?: string;
  vertical?: string;
  [key: string]: string | undefined;
}

export interface CreateConversationOptions {
  agentId: string;
  /** Optional end-user id for analytics (no auth product surface). */
  userId?: string;
  dynamicVariables?: ConversationDynamicVariables;
}

/** Response shape for get_signed_url style endpoints (field names may vary by API version). */
export interface SignedUrlResponse {
  signed_url?: string;
  signedUrl?: string;
  conversation_id?: string;
  conversationId?: string;
}

export interface ConversationTokenResponse {
  token?: string;
  conversation_id?: string;
  conversationId?: string;
}

/** Minimal conversation metadata we care about in-app. */
export interface ConversationRef {
  conversationId: string;
  agentId: string;
  slot?: NegotiatorAgentSlot;
  companyKey?: string;
}

/** Transcript segment for UI streaming (filled by WS / client events). */
export interface TranscriptSegment {
  conversationId: string;
  role: "user" | "agent" | "tool";
  text: string;
  /** Seconds from conversation start when available. */
  timestampSec?: number;
  /** Absolute ISO time when available. */
  at?: string;
  toolName?: string;
}

/** Webhook stub payload when ElevenLabs posts post-call or tool-related events. */
export interface ElevenLabsWebhookStub {
  type?: string;
  event_timestamp?: number;
  data?: Record<string, unknown>;
  conversation_id?: string;
  agent_id?: string;
}

export type CallOutcome =
  | "itemized_quote"
  | "callback_commitment"
  | "documented_decline";

export interface BridgePairIntent {
  /** Negotiator side agent (always buyer). */
  negotiatorAgentId: string;
  /** Counter-agent vendor persona — isolated prompt in ElevenLabs. */
  counterAgentId: string;
  companyKey: "tough" | "stonewaller" | "upseller";
  jobId: string;
  sessionId: string;
  jobSpecJson: string;
  /** UCB1 playbook sentences for the negotiator (optional). */
  playbookHint?: string;
}

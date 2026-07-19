/**
 * Agent-to-agent bridge using duplex ElevenLabs audio when audio events are
 * available, with final-text mediation only as a compatibility fallback.
 *
 * ElevenLabs audio-chunk relay is fragile server-side. Official client events
 * support `user_message` text input that triggers the same response flow as
 * spoken audio — we use that to cross-wire negotiator ↔ counter-agent.
 *
 * Flow:
 * 1. Open two WebSocket conversations (negotiator + counter).
 * 2. Send conversation_initiation_client_data with job/session dynamic vars.
 * 3. Kick off negotiator with a synthetic user_message describing the job.
 * 4. On each FINAL agent_response (not streaming parts), forward to peer.
 * 5. Persist transcripts + tool side-effects via existing webhook tools.
 */
import WebSocket from "ws";
import type { BridgePairIntent } from "./types";
import { getElevenLabsApiKey } from "./env";
import { getStore } from "@/lib/db";
import { publish } from "@/lib/db/events";
import { closeSession } from "@/lib/tools/closeSession";
import {
  enforceNoBookingCommitment,
  sanitizeTranscriptText,
} from "@/lib/evidence/transcript";

const WATCHDOG_MS = 90_000;
const MAX_SESSION_MS = 4 * 60_000;
const WS_URL = "wss://api.elevenlabs.io/v1/convai/conversation";
/** Hard cap on agent↔agent turns (each final agent speech counts). */
const MAX_TURNS = 18;
/** Wait for silence / no superseding text before forwarding a turn. */
const FINAL_DEBOUNCE_MS = 750;
/** Longer wait when text looks truncated mid-phrase. */
const INCOMPLETE_DEBOUNCE_MS = 1400;

export type BridgeResult = {
  sessionId: string;
  negotiatorConversationId: string | null;
  counterConversationId: string | null;
  ok: boolean;
  error?: string;
  turns?: number;
};

type JsonMsg = Record<string, unknown>;

type PendingTurn = {
  text: string;
  timer: ReturnType<typeof setTimeout>;
  fromRole: "negotiator" | "counter";
};

const PCM_16KHZ_SILENCE = Buffer.alloc(16_000 * 2 * 0.7).toString("base64");

function asObj(data: WebSocket.RawData): JsonMsg | null {
  try {
    const text =
      typeof data === "string"
        ? data
        : Buffer.from(data as Buffer).toString("utf8");
    return JSON.parse(text) as JsonMsg;
  } catch {
    return null;
  }
}

function openConversationSocket(
  agentId: string,
  apiKey: string
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = `${WS_URL}?agent_id=${encodeURIComponent(agentId)}`;
    const ws = new WebSocket(url, {
      headers: { "xi-api-key": apiKey },
    });
    const timer = setTimeout(() => {
      reject(new Error(`WS open timeout for agent ${agentId}`));
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }, 15_000);

    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendInit(
  ws: WebSocket,
  intent: BridgePairIntent,
  role: "negotiator" | "counter"
) {
  const common = {
    job_id: intent.jobId,
    session_id: intent.sessionId,
    company_key: intent.companyKey,
    company_name: intent.companyName,
    job_spec_json: intent.jobSpecJson,
    bridge_role: role,
    vertical: intent.vertical || "",
    vertical_name: intent.verticalName || intent.vertical || "service",
    quote_line_items_json: intent.quoteLineItemsJson,
  };
  sendJson(ws, {
    type: "conversation_initiation_client_data",
    dynamic_variables:
      role === "negotiator"
        ? {
            ...common,
            playbook: intent.playbookHint || "",
            negotiation_levers_json: intent.negotiationLeversJson,
          }
        : {
            ...common,
            counter_strategy: intent.counterStrategy,
          },
  });
}

function sendUserMessage(ws: WebSocket, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  sendJson(ws, { type: "user_message", text: trimmed });
}

function extractAudioChunk(msg: JsonMsg): string | null {
  if (String(msg.type || "") !== "audio") return null;
  const event = msg.audio_event as JsonMsg | undefined;
  const encoded = event?.audio_base_64 ?? msg.audio_base_64;
  return typeof encoded === "string" && encoded ? encoded : null;
}

function sendUserAudio(ws: WebSocket, audioChunk: string) {
  // ElevenLabs' WebSocket wire format is intentionally different from other
  // client events: the base64 payload is the top-level property.
  sendJson(ws, { user_audio_chunk: audioChunk });
}

function sendEndOfSpeechSilence(ws: WebSocket) {
  // ElevenLabs VAD needs a short silent tail to finalize a relayed utterance.
  // Without it, the receiving agent can leave the turn open indefinitely.
  sendUserAudio(ws, PCM_16KHZ_SILENCE);
}

/**
 * Extract only FINAL complete agent turns.
 * Ignores streaming parts (agent_chat_response_part) and non-final types.
 */
function extractFinalAgentText(msg: JsonMsg): string | null {
  const t = String(msg.type || "");

  // Streaming / partial text-only chunks — never forward these mid-turn
  if (
    t === "agent_chat_response_part" ||
    t.includes("chat_response_part") ||
    t.includes("partial") ||
    t.includes("tentative")
  ) {
    return null;
  }

  // Canonical final event
  if (t === "agent_response") {
    const evt = msg.agent_response_event as JsonMsg | undefined;
    if (evt?.agent_response) return String(evt.agent_response).trim();
    if (typeof msg.agent_response === "string") return msg.agent_response.trim();
    if (typeof msg.text === "string") return msg.text.trim();
  }

  // Nested agent_response_event without type (some API versions)
  if (msg.agent_response_event && !t.includes("correction")) {
    const evt = msg.agent_response_event as JsonMsg;
    if (typeof evt.agent_response === "string") {
      return evt.agent_response.trim();
    }
  }

  // Correction after barge-in: use corrected text as the final spoken turn
  if (t === "agent_response_correction") {
    const evt = msg.agent_response_correction_event as JsonMsg | undefined;
    if (evt?.corrected_agent_response) {
      return String(evt.corrected_agent_response).trim();
    }
  }

  return null;
}

function extractConversationId(msg: JsonMsg): string | null {
  if (typeof msg.conversation_id === "string") return msg.conversation_id;
  if (typeof msg.conversationId === "string") return msg.conversationId;
  const meta = msg.conversation_initiation_metadata_event as JsonMsg | undefined;
  if (meta?.conversation_id) return String(meta.conversation_id);
  return null;
}

/** Heuristic: text looks like a truncated partial ("Hello, I am an…"). */
function looksIncomplete(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return true;
  if (/[…]\s*$/.test(t) || /\.\.\.\s*$/.test(t)) return true;
  // Ends mid-article / mid-phrase without terminal punctuation
  if (/\b(a|an|the|I am|I'm|we can|looking at|about)\s*$/i.test(t)) return true;
  // No sentence end and very short
  if (t.length < 40 && !/[.!?]\s*$/.test(t)) return true;
  return false;
}

function buildKickoff(intent: BridgePairIntent): string {
  let job: Record<string, unknown> = {};
  try {
    job = JSON.parse(intent.jobSpecJson) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const vertical = intent.vertical || "service";

  const parts = [
    "You are on a live call with a vendor dispatcher. Sound like a calm buying consultant.",
    `Vertical: ${intent.verticalName || vertical}.`,
    `Required quote categories: ${intent.quoteLineItemsJson}.`,
    `Company key: ${intent.companyKey}.`,
    "RULES: One idea per turn (1–3 short sentences). Always answer them. Never send only '…' or partial words. Never re-greet after the call has started. Never speak tool names.",
    "Open once: AI disclosure + job from JSON (use their real city/ZIP) + ask for itemized total. Then listen.",
    "When you have a firm total: log_quote then close_session. Callback-only: close_session as callback_commitment. Hard refuse: documented_decline. Never accept, book, schedule, purchase, authorize work, or say go ahead; only ask for a written quote or callback window for human review.",
    `Job JSON: ${JSON.stringify(job)}`,
  ];
  if (intent.playbookHint) {
    parts.push(`Playbook (soft tactics only; never invent $): ${intent.playbookHint}`);
  }
  return parts.join(" ");
}

function detectCallbackLanguage(text: string): string | null {
  if (
    /call( you)? back|callback|on-?site|site visit|won't quote|do not quote|don't quote|can't (give|put) a (price|number)|no phone (price|quote)/i.test(
      text
    )
  ) {
    const windowMatch = text.match(
      /(?:between|tomorrow|weekday|morning|afternoon|next)\s[^.]{0,60}/i
    );
    return windowMatch?.[0]?.trim() || "callback / site visit offered";
  }
  return null;
}

export async function runAgentBridge(
  intent: BridgePairIntent
): Promise<BridgeResult> {
  const apiKey = getElevenLabsApiKey();
  const store = getStore();
  const sessionStartMs = Date.now();
  let lastEvent = Date.now();
  let closed = false;
  let turns = 0;
  /** Single shared close chain — serverless must await this before return */
  let closePromise: Promise<void> | null = null;

  let negWs: WebSocket | null = null;
  let ctrWs: WebSocket | null = null;
  let negCid: string | null = null;
  let ctrCid: string | null = null;

  const seenNeg = new Set<string>();
  const seenCtr = new Set<string>();
  const audioForwarded = { negotiator: false, counter: false };
  const audioIdleTimers: Partial<Record<"negotiator" | "counter", ReturnType<typeof setTimeout>>> = {};
  const agentTurnCount = { negotiator: 0, counter: 0 };
  const pendingByRole: Partial<
    Record<"negotiator" | "counter", PendingTurn>
  > = {};

  const spoken: { speaker: string; text: string }[] = [];

  const touch = () => {
    lastEvent = Date.now();
    void store.updateSession(intent.sessionId, {
      last_event_at: new Date().toISOString(),
    });
  };

  const relTs = () => Math.max(0, Date.now() - sessionStartMs);

  const append = async (speaker: string, text: string) => {
    const clean = sanitizeTranscriptText(text);
    if (!clean) return;
    const ts_ms = relTs();
    spoken.push({ speaker, text: clean });
    await store.appendTranscript({
      session_id: intent.sessionId,
      ts_ms,
      speaker,
      text: clean,
    });
    publish({
      type: "transcript",
      job_id: intent.jobId,
      session_id: intent.sessionId,
      payload: { speaker, text: clean, ts_ms },
    });
  };

  const clearPending = (role: "negotiator" | "counter") => {
    const p = pendingByRole[role];
    if (p) {
      clearTimeout(p.timer);
      delete pendingByRole[role];
    }
  };

  const clearAudioIdle = (role: "negotiator" | "counter") => {
    const timer = audioIdleTimers[role];
    if (timer) clearTimeout(timer);
    delete audioIdleTimers[role];
  };

  const scheduleAudioTurnEnd = (
    fromRole: "negotiator" | "counter",
    to: WebSocket,
  ) => {
    clearAudioIdle(fromRole);
    audioIdleTimers[fromRole] = setTimeout(() => {
      delete audioIdleTimers[fromRole];
      if (!closed && to.readyState === WebSocket.OPEN) sendEndOfSpeechSilence(to);
    }, 900);
  };

  const forceClose = (reason: string): Promise<void> => {
    // Single closePromise chain — concurrent callers share one write
    if (closePromise) return closePromise;
    closePromise = (async () => {
      clearPending("negotiator");
      clearPending("counter");
      clearAudioIdle("negotiator");
      clearAudioIdle("counter");

      try {
        const session = await store.getSession(intent.sessionId);
        if (session && !session.outcome_type) {
          const allText = spoken.map((s) => s.text).join(" ");
          const vendorText = spoken
            .filter((s) => s.speaker === "vendor")
            .map((s) => s.text)
            .join(" ");
          const quotes = await store.listQuotesByJob(intent.jobId);
          const sessionQuotes = quotes
            .filter((q) => q.session_id === intent.sessionId)
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          const hasLoggedQuotes = sessionQuotes.length > 0;

          const callback = detectCallbackLanguage(vendorText || allText);
          const canItemize = intent.companyKey !== "stonewaller" && hasLoggedQuotes;

          if (canItemize) {
            const res = await closeSession({
              session_id: intent.sessionId,
              job_id: intent.jobId,
              outcome_type: "itemized_quote",
              summary: reason,
            });
            if (!res.ok) {
              // A spoken or one-line total is not upgraded into an itemized
              // quote. Preserve the transcript and fail honestly.
              await closeSession({
                session_id: intent.sessionId,
                job_id: intent.jobId,
                outcome_type: "documented_decline",
                callback_window: `${reason}; incomplete quote: ${res.error}`,
              });
            }
          } else if (callback || intent.companyKey === "stonewaller") {
            const res = await closeSession({
              session_id: intent.sessionId,
              job_id: intent.jobId,
              outcome_type: callback
                ? "callback_commitment"
                : "documented_decline",
              callback_window: callback || reason,
              summary: reason,
            });
            if (!res.ok) {
              await closeSession({
                session_id: intent.sessionId,
                job_id: intent.jobId,
                outcome_type: "documented_decline",
                callback_window: reason,
              });
            }
          } else {
            // No firm total → never invent itemized_quote from stray $
            await closeSession({
              session_id: intent.sessionId,
              job_id: intent.jobId,
              outcome_type: callback
                ? "callback_commitment"
                : "documented_decline",
              callback_window: reason,
            });
          }

          publish({
            type: "session",
            job_id: intent.jobId,
            session_id: intent.sessionId,
            payload: { outcome: "forced_close", reason },
          });
        }
      } finally {
        closed = true;
        try {
          negWs?.close();
          ctrWs?.close();
        } catch {
          /* ignore */
        }
      }
    })();
    return closePromise;
  };

  const maybeAutoCloseFromSpeech = (fromRole: "negotiator" | "counter", text: string) => {
    // After firm total or callback, prefer structured close soon
    if (fromRole === "counter") {
      const cb = detectCallbackLanguage(text);
      if (cb && intent.companyKey === "stonewaller" && turns >= 4) {
        void forceClose(`stonewaller callback: ${cb}`);
        return;
      }
    }
    if (
      fromRole === "negotiator" &&
      /thank you|we'll take it|logged|closing|goodbye|have a (great|good) day/i.test(
        text
      ) &&
      turns >= 6
    ) {
      // Negotiator signaled wrap-up; give tools a beat then force if still open
      setTimeout(() => {
        void forceClose("negotiator signaled close");
      }, 2500);
    }
  };

  const commitFinalTurn = (
    fromRole: "negotiator" | "counter",
    text: string,
    to: WebSocket,
    seen: Set<string>
  ) => {
    if (closed) return;
    const clean = sanitizeTranscriptText(text);
    if (!clean) return;
    const trimmed = fromRole === "negotiator"
      ? enforceNoBookingCommitment(clean)
      : clean;
    if (!trimmed) return;

    // Prefer longest unique key to collapse "Hello" → "Hello, I am..." supersedes
    const key = trimmed.slice(0, 240);
    // Drop if exact or near-duplicate already forwarded
    for (const s of seen) {
      if (s === key) return;
      if (key.startsWith(s.slice(0, 40)) && key.length > s.length) {
        // longer extension of prior short — allow (remove short key)
        seen.delete(s);
      } else if (s.startsWith(key.slice(0, 40)) && s.length >= key.length) {
        return; // already have equal/longer
      }
    }
    seen.add(key);

    turns += 1;
    agentTurnCount[fromRole] += 1;
    const speaker = fromRole === "negotiator" ? "negotiator" : "vendor";
    void append(speaker, trimmed);
    maybeAutoCloseFromSpeech(fromRole, trimmed);

    if (turns >= MAX_TURNS) {
      void forceClose("max turns reached");
      return;
    }

    if (
      to.readyState === WebSocket.OPEN &&
      !closed &&
      !audioForwarded[fromRole]
    ) {
      sendUserMessage(to, trimmed);
    } else if (audioForwarded[fromRole]) {
      // Audio is the primary transport. A semantic fallback only fires if the
      // receiving agent remains silent after the audio/VAD turn has completed.
      const peer = fromRole === "negotiator" ? "counter" : "negotiator";
      const peerTurnsBeforeAudio = agentTurnCount[peer];
      setTimeout(() => {
        if (
          !closed &&
          to.readyState === WebSocket.OPEN &&
          agentTurnCount[peer] === peerTurnsBeforeAudio
        ) {
          sendUserMessage(to, trimmed);
        }
      }, 4_000);
    }
  };

  /**
   * Debounce: only forward FINAL complete turns.
   * If a longer superseding text arrives before the timer, replace buffer.
   */
  const scheduleFinalTurn = (
    fromRole: "negotiator" | "counter",
    text: string,
    to: WebSocket,
    seen: Set<string>
  ) => {
    if (closed) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const existing = pendingByRole[fromRole];
    if (existing) {
      // Supersede if new text extends prior partial, or is clearly longer final
      const prev = existing.text;
      if (
        trimmed === prev ||
        (prev.startsWith(trimmed) && prev.length > trimmed.length)
      ) {
        // shorter or same — keep longer pending
        return;
      }
      clearTimeout(existing.timer);
    }

    const wait = looksIncomplete(trimmed)
      ? INCOMPLETE_DEBOUNCE_MS
      : FINAL_DEBOUNCE_MS;

    const timer = setTimeout(() => {
      delete pendingByRole[fromRole];
      commitFinalTurn(fromRole, trimmed, to, seen);
    }, wait);

    pendingByRole[fromRole] = { text: trimmed, timer, fromRole };
  };

  const watchdog = setInterval(() => {
    if (Date.now() - lastEvent > WATCHDOG_MS) {
      void forceClose("timeout: no events for 90s");
      clearInterval(watchdog);
    }
  }, 5_000);

  try {
    await store.updateSession(intent.sessionId, { status: "connecting" });
    publish({
      type: "session",
      job_id: intent.jobId,
      session_id: intent.sessionId,
      payload: { status: "connecting" },
    });

    [negWs, ctrWs] = await Promise.all([
      openConversationSocket(intent.negotiatorAgentId, apiKey),
      openConversationSocket(intent.counterAgentId, apiKey),
    ]);

    const handleSide = (
      from: WebSocket,
      to: WebSocket,
      fromRole: "negotiator" | "counter",
      seen: Set<string>
    ) => {
      from.on("message", (raw) => {
        touch();
        const msg = asObj(raw);
        if (!msg) return;

        const cid = extractConversationId(msg);
        if (cid) {
          if (fromRole === "negotiator") negCid = cid;
          else ctrCid = cid;
        }

        if (msg.type === "ping" && msg.ping_event) {
          const eventId = (msg.ping_event as JsonMsg).event_id;
          sendJson(from, {
            type: "pong",
            event_id: eventId,
          });
          return;
        }

        const audioChunk = extractAudioChunk(msg);
        if (audioChunk && to.readyState === WebSocket.OPEN && !closed) {
          audioForwarded[fromRole] = true;
          sendUserAudio(to, audioChunk);
          scheduleAudioTurnEnd(fromRole, to);
        }

        const agentText = extractFinalAgentText(msg);
        if (!agentText) return;

        scheduleFinalTurn(fromRole, agentText, to, seen);
      });

      from.on("error", (err) => {
        console.error(`[bridge] ${fromRole} ws error`, err);
      });
    };

    handleSide(negWs, ctrWs, "negotiator", seenNeg);
    handleSide(ctrWs, negWs, "counter", seenCtr);

    sendInit(negWs, intent, "negotiator");
    sendInit(ctrWs, intent, "counter");

    await store.updateSession(intent.sessionId, {
      status: "live",
      last_event_at: new Date().toISOString(),
    });
    publish({
      type: "session",
      job_id: intent.jobId,
      session_id: intent.sessionId,
      payload: { status: "live" },
    });

    await new Promise((r) => setTimeout(r, 400));

    const kickoff = buildKickoff(intent);
    sendUserMessage(negWs, kickoff);
    touch();

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        resolve();
      };
      const onPeerClose = () => {
        void forceClose("peer socket closed").finally(finish);
      };
      negWs!.on("close", onPeerClose);
      ctrWs!.on("close", onPeerClose);
      setTimeout(() => {
        void forceClose("session wall clock").finally(finish);
      }, MAX_SESSION_MS);
    });

    // Always await the close chain so serverless does not drop outcomes
    if (closePromise) {
      await closePromise;
    }

    await store.updateSession(intent.sessionId, {
      negotiator_conversation_id: negCid,
      counter_conversation_id: ctrCid,
      last_event_at: new Date().toISOString(),
    });

    const final = await store.getSession(intent.sessionId);
    if (final && !final.outcome_type) {
      await forceClose("bridge ended without structured close_session");
    } else if (closePromise) {
      await closePromise;
    }

    return {
      sessionId: intent.sessionId,
      negotiatorConversationId: negCid,
      counterConversationId: ctrCid,
      ok: true,
      turns,
    };
  } catch (e) {
    clearInterval(watchdog);
    const error = e instanceof Error ? e.message : String(e);
    await store.updateSession(intent.sessionId, {
      status: "error",
      recording_note: error,
    });
    // Still try best-effort close so deal review can run
    try {
      await forceClose(`bridge_error: ${error}`);
    } catch {
      /* ignore */
    }
    publish({
      type: "session",
      job_id: intent.jobId,
      session_id: intent.sessionId,
      payload: { status: "error", error },
    });
    return {
      sessionId: intent.sessionId,
      negotiatorConversationId: negCid,
      counterConversationId: ctrCid,
      ok: false,
      error,
    };
  } finally {
    clearInterval(watchdog);
    clearPending("negotiator");
    clearPending("counter");
    clearAudioIdle("negotiator");
    clearAudioIdle("counter");
    // Drain any in-flight close before sockets/process go away
    if (closePromise) {
      try {
        await closePromise;
      } catch {
        /* ignore */
      }
    }
    try {
      negWs?.close();
      ctrWs?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Sequential fallback (debug only). Prefer runBridgesParallel for live demos. */
export async function runBridgesSequential(
  intents: BridgePairIntent[]
): Promise<BridgeResult[]> {
  const results: BridgeResult[] = [];
  for (const intent of intents) {
    results.push(await runAgentBridge(intent));
  }
  return results;
}

/**
 * Multi-agent orchestration: run all negotiator↔vendor bridges at once.
 * Each vendor pair is independent; UI sees simultaneous transcripts.
 */
export async function runBridgesParallel(
  intents: BridgePairIntent[]
): Promise<BridgeResult[]> {
  console.log(
    `[bridge] parallel orchestration n=${intents.length} sessions=${intents
      .map((i) => i.companyKey)
      .join(",")}`
  );
  return Promise.all(intents.map((intent) => runAgentBridge(intent)));
}

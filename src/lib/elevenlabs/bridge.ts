/**
 * Agent-to-agent bridge using TEXT mediation (not raw audio relay).
 *
 * ElevenLabs audio-chunk relay is fragile server-side. Official client events
 * support `user_message` text input that triggers the same response flow as
 * spoken audio — we use that to cross-wire negotiator ↔ counter-agent.
 *
 * Flow:
 * 1. Open two WebSocket conversations (negotiator + counter).
 * 2. Send conversation_initiation_client_data with job/session dynamic vars.
 * 3. Kick off negotiator with a synthetic user_message describing the job.
 * 4. On each agent_response_event, forward that text as user_message to the peer.
 * 5. Persist transcripts + tool side-effects via existing webhook tools.
 */
import WebSocket from "ws";
import type { BridgePairIntent } from "./types";
import { getElevenLabsApiKey } from "./env";
import { getStore } from "@/lib/db";
import { publish } from "@/lib/db/events";

const WATCHDOG_MS = 90_000;
const MAX_SESSION_MS = 4 * 60_000;
const WS_URL = "wss://api.elevenlabs.io/v1/convai/conversation";
/** Avoid infinite ping-pong loops */
const MAX_TURNS = 24;

export type BridgeResult = {
  sessionId: string;
  negotiatorConversationId: string | null;
  counterConversationId: string | null;
  ok: boolean;
  error?: string;
  turns?: number;
};

type JsonMsg = Record<string, unknown>;

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
  sendJson(ws, {
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      job_id: intent.jobId,
      session_id: intent.sessionId,
      company_key: intent.companyKey,
      job_spec_json: intent.jobSpecJson,
      bridge_role: role,
      playbook: intent.playbookHint || "",
    },
  });
}

function sendUserMessage(ws: WebSocket, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Official client→server event
  sendJson(ws, { type: "user_message", text: trimmed });
}

function extractAgentText(msg: JsonMsg): string | null {
  // Common shapes from ElevenLabs ConvAI WS
  const agentEvt = msg.agent_response_event as JsonMsg | undefined;
  if (agentEvt?.agent_response) return String(agentEvt.agent_response);

  if (msg.type === "agent_response" && typeof msg.agent_response === "string") {
    return msg.agent_response;
  }
  if (msg.type === "agent_response" && typeof msg.text === "string") {
    return msg.text;
  }

  // Some versions nest under data
  const data = msg.data as JsonMsg | undefined;
  if (data?.agent_response) return String(data.agent_response);

  // Final agent response event
  if (
    msg.type === "agent_response_event" ||
    String(msg.type || "").includes("agent_response")
  ) {
    if (typeof msg.agent_response === "string") return msg.agent_response;
    if (typeof msg.text === "string") return msg.text;
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

function buildKickoff(intent: BridgePairIntent): string {
  let job: Record<string, unknown> = {};
  try {
    job = JSON.parse(intent.jobSpecJson) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const parts = [
    "You are on a live negotiation with a vendor. Start now.",
    `Company key: ${intent.companyKey}.`,
    "Introduce yourself as an AI assistant negotiating for a homeowner, describe the job once, and ask for an itemized installed quote.",
    `Job JSON: ${JSON.stringify(job)}`,
    "Use tools when you have numbers. Close with a structured outcome when done.",
  ];
  if (intent.playbookHint) {
    parts.push(`Playbook (learned tactics to prefer): ${intent.playbookHint}`);
  }
  return parts.join(" ");
}

export async function runAgentBridge(
  intent: BridgePairIntent
): Promise<BridgeResult> {
  const apiKey = getElevenLabsApiKey();
  const store = getStore();
  let lastEvent = Date.now();
  let closed = false;
  let turns = 0;

  let negWs: WebSocket | null = null;
  let ctrWs: WebSocket | null = null;
  let negCid: string | null = null;
  let ctrCid: string | null = null;

  // Deduplicate forwarded agent texts
  const seenNeg = new Set<string>();
  const seenCtr = new Set<string>();

  const touch = () => {
    lastEvent = Date.now();
    void store.updateSession(intent.sessionId, {
      last_event_at: new Date().toISOString(),
    });
  };

  const append = async (speaker: string, text: string) => {
    const ts_ms = Date.now() % 1_000_000_000;
    await store.appendTranscript({
      session_id: intent.sessionId,
      ts_ms,
      speaker,
      text,
    });
    publish({
      type: "transcript",
      job_id: intent.jobId,
      session_id: intent.sessionId,
      payload: { speaker, text, ts_ms },
    });
  };

  const forceClose = async (reason: string) => {
    if (closed) return;
    closed = true;
    const session = await store.getSession(intent.sessionId);
    if (session && !session.outcome_type) {
      await store.closeSession(
        intent.sessionId,
        "documented_decline",
        reason
      );
      publish({
        type: "session",
        job_id: intent.jobId,
        session_id: intent.sessionId,
        payload: { outcome: "documented_decline", reason },
      });
    }
    try {
      negWs?.close();
      ctrWs?.close();
    } catch {
      /* ignore */
    }
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

        // Pings
        if (msg.type === "ping" && msg.ping_event) {
          const eventId = (msg.ping_event as JsonMsg).event_id;
          sendJson(from, {
            type: "pong",
            event_id: eventId,
          });
          return;
        }

        // Skip user_transcription_event entirely: kickoff is a synthetic
        // user_message, and cross-wired peer text also arrives as user_message.
        // Logging those would leak the kickoff brief and double every turn.

        const agentText = extractAgentText(msg);
        if (!agentText) return;

        const key = agentText.slice(0, 200);
        if (seen.has(key)) return;
        seen.add(key);

        turns += 1;
        const speaker = fromRole === "negotiator" ? "negotiator" : "vendor";
        void append(speaker, agentText);

        if (turns >= MAX_TURNS) {
          void forceClose("max turns reached");
          return;
        }

        // Cross-wire: agent speech → peer as user_message
        if (to.readyState === WebSocket.OPEN && !closed) {
          sendUserMessage(to, agentText);
        }
      });

      from.on("error", (err) => {
        console.error(`[bridge] ${fromRole} ws error`, err);
      });
    };

    // Register listeners BEFORE init/kickoff so first agent_response is not dropped
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

    // Small delay so initiation is processed
    await new Promise((r) => setTimeout(r, 400));

    // Kickoff: synthetic homeowner brief so the negotiator opens the call.
    // (Not shown as a chat bubble — it's internal orchestration, not spoken.)
    const kickoff = buildKickoff(intent);
    sendUserMessage(negWs, kickoff);
    touch();

    await new Promise<void>((resolve) => {
      const done = () => {
        if (closed) {
          resolve();
          return;
        }
        closed = true;
        clearInterval(watchdog);
        resolve();
      };
      negWs!.on("close", done);
      ctrWs!.on("close", done);
      setTimeout(() => {
        void forceClose("session wall clock");
        done();
      }, MAX_SESSION_MS);
    });

    await store.updateSession(intent.sessionId, {
      negotiator_conversation_id: negCid,
      counter_conversation_id: ctrCid,
      last_event_at: new Date().toISOString(),
    });

    // If still open without outcome, close politely
    const final = await store.getSession(intent.sessionId);
    if (final && !final.outcome_type) {
      await store.closeSession(
        intent.sessionId,
        "documented_decline",
        "bridge ended without structured close_session"
      );
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

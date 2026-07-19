/**
 * Mock / golden-run stream for the dashboard.
 * Prefer live GET /api/jobs/[id]/state when available.
 */

import type {
  GoldenRun,
  JobState,
  MockEvent,
  RankedDeal,
  SessionCard,
  VerticalConfig,
} from "./types";
import {
  benchmarkMidFor,
  demoJobSpec,
  redFlagThresholdPct,
  vendorDisplayName,
} from "./types";
import { isDisplayableTranscript } from "@/lib/evidence/transcript";

export function emptySessions(vertical: VerticalConfig): SessionCard[] {
  return vertical.vendors.map((v) => ({
    vendor_id: v.id,
    vendor_name: vendorDisplayName(v),
    persona: v.persona || v.role || v.id,
    status: "idle",
    current_price: null,
    transcript: [],
    competing_bid_used: false,
    audio_url: null,
    outcome: null,
    line_items: [],
  }));
}

export function initialJobState(vertical: VerticalConfig): JobState {
  return {
    job_id: null,
    phase: "draft",
    job_spec: null,
    sessions: emptySessions(vertical),
    ranked: [],
    deal_review: null,
  };
}

function cloneSessions(sessions: SessionCard[]): SessionCard[] {
  return sessions.map((s) => ({
    ...s,
    transcript: [...s.transcript],
    line_items: [...s.line_items],
  }));
}

export function applyMockEvent(
  state: JobState,
  event: MockEvent,
  vertical: VerticalConfig,
): JobState {
  if (event.type === "complete") {
    const ranked = rankSessions(state.sessions, vertical);
    return {
      ...state,
      phase: "complete",
      ranked,
      deal_review: buildClientDealReview(ranked, state.sessions, vertical),
    };
  }

  const sessions = cloneSessions(state.sessions);
  const idx = sessions.findIndex((s) => s.vendor_id === event.vendor_id);
  if (idx < 0) return state;
  const s = { ...sessions[idx] };

  switch (event.type) {
    case "status":
      s.status = event.status;
      break;
    case "transcript":
      s.transcript = [
        ...s.transcript,
        {
          id: `${event.vendor_id}-${event.ts}-${s.transcript.length}`,
          speaker: event.speaker,
          text: event.text,
          ts: event.ts,
        },
      ];
      break;
    case "price":
      s.current_price = event.price;
      break;
    case "competing_bid_used":
      s.competing_bid_used = true;
      break;
    case "outcome":
      s.outcome = event.outcome;
      if (event.price !== undefined) s.current_price = event.price;
      if (event.line_items) s.line_items = event.line_items;
      if (event.why) s.why = event.why;
      if (event.callback_at) s.callback_at = event.callback_at;
      if (event.outcome === "documented_decline") s.status = "declined";
      else if (
        event.outcome === "itemized_quote" ||
        event.outcome === "callback_commitment"
      ) {
        s.status = "done";
      }
      break;
  }

  sessions[idx] = s;
  return { ...state, sessions };
}

export function redFlagForPrice(
  price: number | null | undefined,
  vertical: VerticalConfig,
  jobType?: string | null,
): { red_flag: boolean; red_flag_pct?: number } {
  if (price == null || !Number.isFinite(price)) {
    return { red_flag: false };
  }
  const mid = benchmarkMidFor(vertical, jobType);
  if (mid == null || mid <= 0) return { red_flag: false };
  const thresholdFrac = vertical.red_flag.threshold_below_benchmark ?? 0.3;
  if (price <= mid * (1 - thresholdFrac)) {
    const pctBelow = Math.round(((mid - price) / mid) * 100);
    return { red_flag: true, red_flag_pct: pctBelow };
  }
  return { red_flag: false };
}

/** Rank itemized quotes; red-flag never recommended as #1 when never_rank_first. */
/** Client-side review when replaying golden / mock streams (no API). */
export function buildClientDealReview(
  ranked: RankedDeal[],
  sessions: SessionCard[],
  vertical: VerticalConfig,
): import("./types").DealReviewUi {
  const top =
    ranked.find((r) => r.recommended && !r.red_flag) ||
    ranked.find((r) => !r.red_flag && r.session.current_price != null) ||
    null;
  const formatUsd = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const why_top: string[] = [];
  if (top?.session.current_price != null) {
    why_top.push(
      `We recommend ${top.session.vendor_name} at ${formatUsd(
        top.session.current_price,
      )} — a complete itemized total, not a teaser.`,
    );
    if (top.session.competing_bid_used) {
      why_top.push(
        "The agent used a real competing bid from another shop to negotiate the price down.",
      );
    }
    why_top.push(
      top.why ||
        "This is the best clean quote after comparing all three simultaneous calls.",
    );
  } else {
    why_top.push("No clean itemized winner yet.");
  }

  const others = ranked
    .filter((r) => !top || r.session.vendor_id !== top.session.vendor_id)
    .map((r) => {
      if (r.red_flag && r.session.current_price != null) {
        return `${r.session.vendor_name}: quoted ${formatUsd(
          r.session.current_price,
        )} but flagged as bait-risk (≥${redFlagThresholdPct(
          vertical,
        )}% under market mid).`;
      }
      if (r.session.outcome === "documented_decline") {
        return `${r.session.vendor_name}: would not give a firm phone price.`;
      }
      return `${r.session.vendor_name}: ${r.why || "see call transcript."}`;
    });

  return {
    headline: top
      ? top.session.current_price != null
        ? `Recommended: ${top.session.vendor_name} at ${formatUsd(
            top.session.current_price,
          )}`
        : `Recommended: ${top.session.vendor_name}`
      : "No single recommended deal yet",
    top_pick: top
      ? {
          vendor_id: top.session.vendor_id,
          vendor_name: top.session.vendor_name,
          total: top.session.current_price,
          outcome: top.session.outcome,
          red_flag: top.red_flag,
          red_flag_pct: top.red_flag_pct,
          label: top.recommended ? "Best clean quote" : "Top ranked",
          plain: top.why,
        }
      : null,
    why_top,
    how_others_compared: others,
    how_we_negotiated: [
      "Three AI negotiators called three providers at the same time.",
      "Each call asked for an itemized installed total.",
      "Suspicious under-market quotes never rank #1.",
      "A review layer picked one clear recommendation for you.",
    ],
    confidence: top ? 88 : 40,
    verdicts: sessions.map((s) => ({
      vendor_id: s.vendor_id,
      vendor_name: s.vendor_name,
      total: s.current_price,
      plain: s.why || s.outcome || "pending",
      red_flag: Boolean(s.red_flag),
      label: s.outcome || "pending",
    })),
  };
}

export function rankSessions(
  sessions: SessionCard[],
  vertical: VerticalConfig,
  jobType?: string | null,
): RankedDeal[] {
  const neverFirst = vertical.red_flag.never_rank_first !== false;

  const quotes = sessions
    .filter((s) => s.outcome === "itemized_quote" && s.current_price != null)
    .map((s) => {
      const rf = redFlagForPrice(s.current_price, vertical, jobType);
      return {
        session: {
          ...s,
          red_flag: rf.red_flag,
          red_flag_pct: rf.red_flag_pct,
        },
        red_flag: rf.red_flag,
        red_flag_pct: rf.red_flag_pct,
        price: s.current_price as number,
      };
    });

  quotes.sort((a, b) => {
    if (neverFirst && a.red_flag !== b.red_flag) return a.red_flag ? 1 : -1;
    return a.price - b.price;
  });

  const rest = sessions.filter(
    (s) => s.outcome && s.outcome !== "itemized_quote",
  );

  const ranked: RankedDeal[] = [];
  quotes.forEach((q, i) => {
    const recommended =
      i === 0 && (!neverFirst || !q.red_flag);
    ranked.push({
      rank: i + 1,
      session: q.session,
      recommended,
      red_flag: q.red_flag,
      red_flag_pct: q.red_flag_pct,
      why:
        q.session.why ||
        (q.red_flag
          ? `Flagged: ≥${redFlagThresholdPct(vertical)}% below market.`
          : "Best clean itemized quote."),
    });
  });

  if (ranked.length && !ranked.some((r) => r.recommended)) {
    const firstClean = ranked.find((r) => !r.red_flag);
    if (firstClean) firstClean.recommended = true;
  }

  rest.forEach((s) => {
    ranked.push({
      rank: ranked.length + 1,
      session: s,
      recommended: false,
      red_flag: false,
      why: s.why || "No itemized quote.",
    });
  });

  return ranked;
}

export type StreamHandle = { stop: () => void };

export function playMockStream(
  events: MockEvent[],
  vertical: VerticalConfig,
  onState: (state: JobState) => void,
  opts?: { speed?: number; job_spec?: Record<string, string | number | boolean | null> },
): StreamHandle {
  const speed = opts?.speed ?? 1.5;
  let state: JobState = {
    job_id: `mock-${Date.now()}`,
    phase: "calling",
    job_spec: opts?.job_spec ?? demoJobSpec(vertical),
    sessions: emptySessions(vertical),
    ranked: [],
  };
  onState(state);

  const timers: ReturnType<typeof setTimeout>[] = [];
  const sorted = [...events].sort((a, b) => a.t - b.t);
  // Guarantee a terminal complete so UI never stays busy forever
  if (!sorted.some((e) => e.type === "complete")) {
    const lastT = sorted.length ? sorted[sorted.length - 1].t : 0;
    sorted.push({ t: lastT + 800, type: "complete" });
  }

  for (const ev of sorted) {
    const delay = Math.max(0, ev.t / speed);
    const id = setTimeout(() => {
      state = applyMockEvent(state, ev, vertical);
      onState(state);
    }, delay);
    timers.push(id);
  }

  return {
    stop: () => timers.forEach(clearTimeout),
  };
}

/** Convert backend golden `{ sessions: [...] }` into timed mock events. */
export function goldenSessionsToEvents(golden: GoldenRun): MockEvent[] {
  if (golden.events?.length) return golden.events;
  if (!golden.sessions?.length) return EMBEDDED_HVAC_EVENTS;

  const events: MockEvent[] = [];
  let t = 0;

  for (const sess of golden.sessions) {
    events.push({ t, type: "status", vendor_id: sess.vendor_id, status: "dialing" });
  }
  t += 600;

  for (const sess of golden.sessions) {
    events.push({
      t,
      type: "status",
      vendor_id: sess.vendor_id,
      status: "negotiating",
    });
    t += 150;
  }

  for (const sess of golden.sessions) {
    const quotes = sess.quotes || [];
    if (quotes.length === 0) {
      events.push({
        t,
        type: "transcript",
        vendor_id: sess.vendor_id,
        speaker: "vendor",
        text: "We don't give firm prices over the phone.",
        ts: 8,
      });
      t += 800;
      events.push({
        t,
        type: "outcome",
        vendor_id: sess.vendor_id,
        outcome: "documented_decline",
        price: null,
        callback_at: sess.callback_window || "Weekday callback",
        why: "Refused phone quote; callback logged.",
      });
      events.push({
        t: t + 50,
        type: "status",
        vendor_id: sess.vendor_id,
        status: "declined",
      });
      t += 900;
      continue;
    }

    // First quote price
    const first = quotes[0];
    if (first.total != null) {
      events.push({
        t,
        type: "transcript",
        vendor_id: sess.vendor_id,
        speaker: "vendor",
        text: first.notes || `Initial figure around ${first.total}.`,
        ts: 10,
      });
      events.push({
        t: t + 200,
        type: "price",
        vendor_id: sess.vendor_id,
        price: first.total,
      });
      t += 1000;
    }

    // Price drop / competing bid on second quote
    if (quotes.length > 1) {
      events.push({
        t,
        type: "transcript",
        vendor_id: sess.vendor_id,
        speaker: "negotiator",
        text: "I have a competing written bid I can cite.",
        ts: 20,
      });
      events.push({ t: t + 200, type: "competing_bid_used", vendor_id: sess.vendor_id });
      const last = quotes[quotes.length - 1];
      if (last.total != null) {
        events.push({
          t: t + 500,
          type: "transcript",
          vendor_id: sess.vendor_id,
          speaker: "vendor",
          text: last.notes || `I can do ${last.total} all-in.`,
          ts: 26,
        });
        events.push({
          t: t + 700,
          type: "price",
          vendor_id: sess.vendor_id,
          price: last.total,
        });
      }
      t += 1500;
    }

    const finalQ = quotes[quotes.length - 1];
    const items = (finalQ.line_items || []).map((li, i) => ({
      ...li,
      evidence_ts: 10 + i * 4,
    }));
    events.push({
      t,
      type: "outcome",
      vendor_id: sess.vendor_id,
      outcome: (sess.outcome_type as "itemized_quote") || "itemized_quote",
      price: finalQ.total ?? null,
      line_items: items,
      why: finalQ.notes || "Itemized quote logged.",
    });
    events.push({
      t: t + 50,
      type: "status",
      vendor_id: sess.vendor_id,
      status: "done",
    });
    t += 900;
  }

  events.push({ t: t + 200, type: "complete" });
  return events;
}

export async function loadGoldenRun(
  verticalId: string,
  mode: "default" | "live" = "default",
): Promise<GoldenRun | null> {
  try {
    const q = new URLSearchParams({
      vertical: verticalId,
      ...(mode === "live" ? { live: "1" } : {}),
    });
    const res = await fetch(`/api/demo/replay?${q}`, { cache: "no-store" });
    if (res.ok) return (await res.json()) as GoldenRun;
  } catch {
    /* fall through */
  }

  try {
    const path =
      mode === "live"
        ? "/golden/live-run.json"
        : verticalId === "movers"
          ? "/golden/run-movers.json"
          : "/golden/run.json";
    const res = await fetch(path, { cache: "no-store" });
    if (res.ok) return (await res.json()) as GoldenRun;
  } catch {
    /* fall through */
  }

  return {
    vertical: verticalId,
    events:
      verticalId === "movers" ? EMBEDDED_MOVERS_EVENTS : EMBEDDED_HVAC_EVENTS,
  };
}

export function resolveGoldenEvents(golden: GoldenRun | null): MockEvent[] {
  if (!golden) return EMBEDDED_HVAC_EVENTS;
  if (golden.events?.length) return golden.events;
  if (golden.sessions?.length) return goldenSessionsToEvents(golden);
  return EMBEDDED_HVAC_EVENTS;
}

// Embedded fallbacks use persona vendor_ids only — names come from config
const EMBEDDED_HVAC_EVENTS: MockEvent[] = [
  { t: 0, type: "status", vendor_id: "tough", status: "dialing" },
  { t: 0, type: "status", vendor_id: "stonewaller", status: "dialing" },
  { t: 0, type: "status", vendor_id: "upseller", status: "dialing" },
  { t: 600, type: "status", vendor_id: "tough", status: "negotiating" },
  { t: 700, type: "status", vendor_id: "upseller", status: "negotiating" },
  { t: 800, type: "status", vendor_id: "stonewaller", status: "negotiating" },
  {
    t: 1000,
    type: "transcript",
    vendor_id: "tough",
    speaker: "vendor",
    text: "Full 3-ton install is around ninety-two hundred.",
    ts: 8,
  },
  { t: 1200, type: "price", vendor_id: "tough", price: 9200 },
  {
    t: 1400,
    type: "transcript",
    vendor_id: "upseller",
    speaker: "vendor",
    text: "We can start equipment around forty-two hundred.",
    ts: 9,
  },
  { t: 1600, type: "price", vendor_id: "upseller", price: 4200 },
  {
    t: 2000,
    type: "transcript",
    vendor_id: "stonewaller",
    speaker: "vendor",
    text: "We don't quote over the phone — need an on-site visit.",
    ts: 10,
  },
  {
    t: 3000,
    type: "transcript",
    vendor_id: "tough",
    speaker: "negotiator",
    text: "I have a competing written bid I can reference.",
    ts: 22,
  },
  { t: 3200, type: "competing_bid_used", vendor_id: "tough" },
  {
    t: 3600,
    type: "transcript",
    vendor_id: "tough",
    speaker: "vendor",
    text: "If you book this week I can do eighty-one hundred all-in.",
    ts: 28,
  },
  { t: 3800, type: "price", vendor_id: "tough", price: 8100 },
  {
    t: 4500,
    type: "transcript",
    vendor_id: "upseller",
    speaker: "vendor",
    text: "Plus permit, haul-away, refrigerant, and diagnostic fees.",
    ts: 24,
  },
  { t: 4800, type: "price", vendor_id: "upseller", price: 5200 },
  {
    t: 5500,
    type: "outcome",
    vendor_id: "stonewaller",
    outcome: "documented_decline",
    price: null,
    callback_at: "Tomorrow 10:00 AM",
    why: "Refused phone quote; callback scheduled.",
  },
  { t: 5600, type: "status", vendor_id: "stonewaller", status: "declined" },
  {
    t: 6500,
    type: "outcome",
    vendor_id: "tough",
    outcome: "itemized_quote",
    price: 8100,
    line_items: [
      { label: "Equipment package", amount: 4800, evidence_ts: 8 },
      { label: "Labor & install", amount: 2600, evidence_ts: 28 },
      { label: "Permit & disposal", amount: 700, evidence_ts: 28 },
    ],
    why: "Price dropped after a real competing bid was cited.",
  },
  { t: 6600, type: "status", vendor_id: "tough", status: "done" },
  {
    t: 7500,
    type: "outcome",
    vendor_id: "upseller",
    outcome: "itemized_quote",
    price: 5200,
    line_items: [
      { label: "Base equipment (advertised)", amount: 4200, evidence_ts: 9 },
      { label: "Permit fee", amount: 250, evidence_ts: 24 },
      { label: "Haul-away", amount: 200, evidence_ts: 24 },
      { label: "Refrigerant", amount: 350, evidence_ts: 24 },
      { label: "Diagnostic", amount: 200, evidence_ts: 24 },
    ],
    why: "Hidden fees itemized — total still far below market mid.",
  },
  { t: 7600, type: "status", vendor_id: "upseller", status: "done" },
  { t: 8500, type: "complete" },
];

const EMBEDDED_MOVERS_EVENTS: MockEvent[] = [
  { t: 0, type: "status", vendor_id: "tough", status: "dialing" },
  { t: 0, type: "status", vendor_id: "stonewaller", status: "dialing" },
  { t: 0, type: "status", vendor_id: "upseller", status: "dialing" },
  { t: 600, type: "status", vendor_id: "tough", status: "negotiating" },
  { t: 700, type: "status", vendor_id: "upseller", status: "negotiating" },
  { t: 800, type: "status", vendor_id: "stonewaller", status: "negotiating" },
  { t: 1200, type: "price", vendor_id: "tough", price: 1800 },
  { t: 1400, type: "price", vendor_id: "upseller", price: 650 },
  {
    t: 2000,
    type: "transcript",
    vendor_id: "stonewaller",
    speaker: "vendor",
    text: "We never quote without a survey first.",
    ts: 10,
  },
  { t: 3000, type: "competing_bid_used", vendor_id: "tough" },
  { t: 3400, type: "price", vendor_id: "tough", price: 1550 },
  { t: 4000, type: "price", vendor_id: "upseller", price: 900 },
  {
    t: 5000,
    type: "outcome",
    vendor_id: "stonewaller",
    outcome: "documented_decline",
    price: null,
    callback_at: "Survey tomorrow 2 PM",
    why: "No phone quote; callback logged.",
  },
  { t: 5100, type: "status", vendor_id: "stonewaller", status: "declined" },
  {
    t: 6000,
    type: "outcome",
    vendor_id: "tough",
    outcome: "itemized_quote",
    price: 1550,
    line_items: [
      { label: "Crew + truck", amount: 1200, evidence_ts: 8 },
      { label: "Protection", amount: 150, evidence_ts: 8 },
      { label: "Stairs", amount: 200, evidence_ts: 26 },
    ],
    why: "Dropped after competing bid cited.",
  },
  { t: 6100, type: "status", vendor_id: "tough", status: "done" },
  {
    t: 7000,
    type: "outcome",
    vendor_id: "upseller",
    outcome: "itemized_quote",
    price: 900,
    line_items: [
      { label: "Labor (advertised)", amount: 600, evidence_ts: 9 },
      { label: "Packing kit", amount: 120, evidence_ts: 22 },
      { label: "Stair fee", amount: 100, evidence_ts: 22 },
      { label: "Fuel surcharge", amount: 80, evidence_ts: 22 },
    ],
    why: "Fees itemized — still ≥30% under market mid.",
  },
  { t: 7100, type: "status", vendor_id: "upseller", status: "done" },
  { t: 8000, type: "complete" },
];

/** Map live API GET /api/jobs/[id]/state → JobState */
export function normalizeApiState(
  raw: unknown,
  vertical: VerticalConfig,
): JobState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // Already UI-shaped
  if (o.phase && Array.isArray(o.sessions) && !o.job) {
    return o as unknown as JobState;
  }

  const job = o.job as
    | {
        id: string;
        status?: string;
        job_spec?: JobState["job_spec"];
        confirmed?: boolean;
      }
    | undefined;

  const job_id = job?.id || (o.job_id as string) || null;
  const job_spec =
    job?.job_spec || (o.job_spec as JobState["job_spec"]) || null;

  let phase: JobState["phase"] = "draft";
  const js = job?.status;
  if (js === "complete") phase = "complete";
  else if (js === "running") phase = "calling";
  else if (js === "confirmed" || job?.confirmed) phase = "confirmed";
  else if (js === "draft") phase = "draft";

  const rawSessions = (o.sessions as unknown[]) || [];
  const rawQuotes = (o.quotes as unknown[]) || [];
  const rawTranscripts = (o.transcripts as unknown[]) || [];

  const quotesBySession = new Map<string, Record<string, unknown>[]>();
  for (const q of rawQuotes) {
    const qr = q as Record<string, unknown>;
    const sid = String(qr.session_id || "");
    if (!quotesBySession.has(sid)) quotesBySession.set(sid, []);
    quotesBySession.get(sid)!.push(qr);
  }

  const transcriptsBySession = new Map<string, SessionCard["transcript"]>();
  for (const tr of rawTranscripts) {
    const t = tr as Record<string, unknown>;
    const sid = String(t.session_id || "");
    const list = transcriptsBySession.get(sid) || [];
    list.push({
      id: String(t.id ?? `${sid}-${list.length}`),
      speaker: String(t.speaker || "system"),
      text: String(t.text || ""),
      ts: Math.round(Number(t.ts_ms || 0) / 1000),
    });
    transcriptsBySession.set(sid, list);
  }

  const mapStatus = (s: string | undefined): SessionCard["status"] => {
    switch (s) {
      case "pending":
      case "connecting":
        return "dialing";
      case "live":
        return "negotiating";
      case "closed":
        return "done";
      case "error":
        return "declined";
      default:
        return (s as SessionCard["status"]) || "idle";
    }
  };

  let sessions: SessionCard[] =
    rawSessions.length > 0
      ? rawSessions.map((rs, i) => {
          const r = rs as Record<string, unknown>;
          const vendor_id =
            String(r.vendor_id || "") ||
            vertical.vendors[i]?.id ||
            `v${i}`;
          const vendorMeta = vertical.vendors.find((v) => v.id === vendor_id);
          const sid = String(r.id || "");
          const qlist = quotesBySession.get(sid) || [];
          const latestQ = qlist[qlist.length - 1];
          const outcome = (r.outcome_type as SessionCard["outcome"]) ?? null;
          const status = mapStatus(r.status as string | undefined);
          const finalStatus =
            outcome === "documented_decline"
              ? "declined"
              : outcome
                ? "done"
                : status;

          return {
            vendor_id,
            vendor_name:
              String(r.vendor_name || "") ||
              (vendorMeta ? vendorDisplayName(vendorMeta) : vendor_id),
            persona:
              (vendorMeta?.persona as string) ||
              vendorMeta?.role ||
              vendor_id,
            status: finalStatus,
            // current_total is an internal session field, not proof of an
            // offered price. The API supplies only transcript-evidenced quotes.
            current_price:
              typeof latestQ?.total === "number"
                ? (latestQ.total as number)
                : null,
            transcript: (transcriptsBySession.get(sid) || []).filter((line) =>
              isDisplayableTranscript(line.text),
            ),
            competing_bid_used: Boolean(r.competing_bid_used),
            audio_url: (r.audio_url as string) || null,
            outcome,
            line_items: Array.isArray(latestQ?.line_items)
              ? (latestQ!.line_items as SessionCard["line_items"])
              : [],
            callback_at: (r.callback_window as string) || null,
            session_id: sid,
            red_flag: Boolean(latestQ?.red_flag),
          };
        })
      : emptySessions(vertical);

  // Ensure 3 cards even if sessions still creating
  if (sessions.length === 0) sessions = emptySessions(vertical);

  let ranked: RankedDeal[] = [];
  if (Array.isArray(o.ranked) && (o.ranked as unknown[]).length) {
    const apiRanked = o.ranked as Array<Record<string, unknown>>;
    ranked = apiRanked.map((rq, i) => {
      const vendor_id = String(rq.vendor_id || "");
      const session =
        sessions.find((s) => s.vendor_id === vendor_id) ||
        sessions.find((s) => s.session_id === rq.session_id) ||
        sessions[i];
      const total =
        typeof rq.total === "number"
          ? rq.total
          : session?.current_price ?? null;
      const rf =
        typeof rq.red_flag === "boolean"
          ? {
              red_flag: rq.red_flag,
              red_flag_pct: redFlagForPrice(total, vertical, job_spec?.job_type as string)
                .red_flag_pct,
            }
          : redFlagForPrice(total, vertical, job_spec?.job_type as string);

      const card: SessionCard = {
        ...(session || emptySessions(vertical)[0]),
        current_price: total,
        line_items: Array.isArray(rq.line_items)
          ? (rq.line_items as SessionCard["line_items"])
          : session?.line_items || [],
        red_flag: rf.red_flag,
        red_flag_pct: rf.red_flag_pct,
        outcome: session?.outcome || "itemized_quote",
        vendor_name:
          String(rq.vendor_name || "") || session?.vendor_name || vendor_id,
        vendor_id: vendor_id || session?.vendor_id || `v${i}`,
      };

      return {
        rank: typeof rq.rank === "number" ? rq.rank : i + 1,
        session: card,
        recommended: Boolean(rq.is_winner) && !rf.red_flag,
        red_flag: rf.red_flag,
        red_flag_pct: rf.red_flag_pct,
        why: String(rq.notes || session?.why || ""),
        leverage_chain: Array.isArray(rq.leverage_chain)
          ? (rq.leverage_chain as RankedDeal["leverage_chain"])
          : undefined,
      };
    });

    // Ensure a recommended if none and never_rank_first
    if (ranked.length && !ranked.some((r) => r.recommended)) {
      const clean = ranked.find((r) => !r.red_flag);
      if (clean) clean.recommended = true;
    }
  } else if (phase === "complete") {
    ranked = rankSessions(
      sessions,
      vertical,
      (job_spec?.job_type as string) || null,
    );
  }

  // All sessions terminal → complete
  if (
    phase === "calling" &&
    sessions.length > 0 &&
    sessions.every(
      (s) => s.status === "done" || s.status === "declined" || s.outcome,
    )
  ) {
    phase = "complete";
    if (!ranked.length) {
      ranked = rankSessions(
        sessions,
        vertical,
        (job_spec?.job_type as string) || null,
      );
    }
  }

  // Attach review layer when complete
  let deal_review: JobState["deal_review"] = null;
  // Always surface server review when job is complete (even if all declined / ranked empty)
  if (phase === "complete") {
    const rawReview = (o as { deal_review?: JobState["deal_review"] })
      .deal_review;
    deal_review =
      rawReview && typeof rawReview === "object"
        ? rawReview
        : buildClientDealReview(ranked, sessions, vertical);
  }

  const questions_before_booking = Array.isArray(o.questions_before_booking)
    ? (o.questions_before_booking as NonNullable<
        JobState["questions_before_booking"]
      >)
    : [];
  const booking_request_draft =
    typeof o.booking_request_draft === "string"
      ? o.booking_request_draft
      : undefined;

  return {
    job_id,
    phase,
    job_spec,
    sessions,
    ranked,
    deal_review,
    questions_before_booking,
    booking_request_draft,
  };
}

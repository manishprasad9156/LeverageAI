/**
 * Review layer — evaluates all vendor sessions after multi-agent negotiation
 * and produces a single recommended deal with plain-language reasoning.
 *
 * Deterministic (no paid LLM): always works in live demos.
 */
import type {
  Job,
  Quote,
  RankedQuote,
  Session,
  TranscriptEvent,
  ToolCallRecord,
} from "@/lib/types";
import {
  getBenchmarkMid,
  loadVertical,
  type VerticalConfig,
} from "@/lib/config/loadVertical";
import { resolveJobTypeKey } from "@/lib/types";
import { buildLeverageChain } from "@/lib/tools/leverageChain";

export type DealReviewVerdict = {
  vendor_id: string;
  vendor_name: string;
  total: number | null;
  outcome: string | null;
  red_flag: boolean;
  red_flag_pct?: number;
  /** Short label for the card */
  label: string;
  /** One plain sentence for a homeowner */
  plain: string;
};

export type DealReview = {
  /** Human headline e.g. "We recommend Summit Air at $7,875" */
  headline: string;
  /** Top pick only */
  top_pick: DealReviewVerdict | null;
  /** Why #1 in everyday language (2–4 short sentences) */
  why_top: string[];
  /** How others compared — easy bullets */
  how_others_compared: string[];
  /** What we did as agents (orchestration summary) */
  how_we_negotiated: string[];
  /** Confidence 0–100 for UI meter */
  confidence: number;
  /** Full ordered verdicts for UI */
  verdicts: DealReviewVerdict[];
  generated_at: string;
};

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pctBelow(mid: number, total: number): number {
  if (mid <= 0) return 0;
  return Math.round(((mid - total) / mid) * 100);
}

/**
 * Build layman-friendly deal review from completed multi-agent run.
 */
export function buildDealReview(input: {
  job: Job;
  sessions: Session[];
  quotes: Quote[];
  ranked: RankedQuote[];
  transcripts?: TranscriptEvent[];
  tool_calls?: ToolCallRecord[];
}): DealReview {
  let vertical: VerticalConfig | null = null;
  try {
    vertical = loadVertical(input.job.vertical);
  } catch {
    vertical = null;
  }

  const jobType = resolveJobTypeKey(input.job.job_spec, {
    default_job_type: vertical?.default_job_type,
    benchmark_key: vertical?.red_flag.benchmark_key,
  });
  const mid =
    vertical && jobType
      ? getBenchmarkMid(vertical, jobType)
      : vertical
        ? getBenchmarkMid(
            vertical,
            vertical.default_job_type ||
              Object.keys(vertical.benchmarks)[0] ||
              ""
          )
        : null;

  const thrPct = vertical
    ? Math.round((vertical.red_flag.threshold_below_benchmark || 0.3) * 100)
    : 30;

  // Latest quote per session
  const latestBySession = new Map<string, Quote>();
  for (const q of input.quotes) {
    const prev = latestBySession.get(q.session_id);
    if (!prev || prev.created_at <= q.created_at) {
      latestBySession.set(q.session_id, q);
    }
  }

  const verdicts: DealReviewVerdict[] = input.sessions.map((s) => {
    const q = latestBySession.get(s.id);
    const total = s.current_total ?? q?.total ?? null;
    const red = Boolean(q?.red_flag);
    const rfPct =
      mid != null && total != null && total < mid
        ? pctBelow(mid, total)
        : undefined;

    let label = "No firm quote";
    let plain = `${s.vendor_name} did not give a full itemized price on the call.`;

    if (s.outcome_type === "documented_decline") {
      label = "Would not quote by phone";
      plain = `${s.vendor_name} refused a firm phone price${
        s.callback_window ? ` and offered a callback (${s.callback_window})` : ""
      }. That is logged so you are not left waiting without a record.`;
    } else if (s.outcome_type === "callback_commitment") {
      label = "Callback only";
      plain = `${s.vendor_name} only committed to call you back${
        s.callback_window ? ` (${s.callback_window})` : ""
      } — no installed total yet.`;
    } else if (total != null && red) {
      label = "Too cheap to trust alone";
      plain = `${s.vendor_name} quoted ${formatUsd(total)}, which is about ${
        rfPct ?? thrPct
      }% under the typical market mid${
        mid != null ? ` (${formatUsd(mid)})` : ""
      }. That often means missing fees or a bait price, so we do not recommend it as #1.`;
    } else if (total != null) {
      label = "Clean itemized quote";
      plain = `${s.vendor_name} gave a full itemized total of ${formatUsd(
        total
      )}${mid != null ? ` — near the fair mid of about ${formatUsd(mid)}` : ""}.`;
    }

    return {
      vendor_id: s.vendor_id,
      vendor_name: s.vendor_name,
      total,
      outcome: s.outcome_type,
      red_flag: red,
      red_flag_pct: rfPct,
      label,
      plain,
    };
  });

  // Winner from ranked (is_winner) or first non-red itemized
  const winnerRanked = input.ranked.find((r) => r.is_winner && !r.red_flag);
  const winnerSession = winnerRanked
    ? input.sessions.find((s) => s.id === winnerRanked.session_id)
    : input.sessions.find((s) => {
        const q = latestBySession.get(s.id);
        return (
          s.outcome_type === "itemized_quote" &&
          q &&
          !q.red_flag &&
          (s.current_total ?? q.total) != null
        );
      });

  const top_pick = winnerSession
    ? verdicts.find((v) => v.vendor_id === winnerSession.vendor_id) ?? null
    : null;

  // Concise, strong, jargon-free — 1–2 bullets max
  const why_top: string[] = [];
  if (top_pick && top_pick.total != null) {
    why_top.push(
      `${top_pick.vendor_name} at ${formatUsd(top_pick.total)}: full itemized price, not a teaser.`
    );
    if (mid != null) {
      why_top.push(`In line with the market mid (~${formatUsd(mid)}), not suspiciously low.`);
    }
    const chain = buildLeverageChain({
      session_id: winnerSession!.id,
      quotes: input.quotes,
      tool_calls: input.tool_calls || [],
      transcripts: input.transcripts || [],
    });
    if (chain.some((c) => c.kind === "get_competing_bids")) {
      why_top.push("Price dropped after we showed a real competing bid from this same job.");
    }
  } else {
    why_top.push("No clean winner yet. Check callbacks below or run again.");
  }

  const how_others_compared = verdicts
    .filter((v) => !top_pick || v.vendor_id !== top_pick.vendor_id)
    .map((v) => {
      if (v.red_flag && v.total != null) {
        return `${v.vendor_name}: ${formatUsd(v.total)} — too far under market (risk of hidden fees).`;
      }
      if (v.outcome === "documented_decline" || v.outcome === "callback_commitment") {
        return `${v.vendor_name}: no firm price on the phone.`;
      }
      if (v.total != null) return `${v.vendor_name}: ${formatUsd(v.total)}.`;
      return `${v.vendor_name}: no quote.`;
    });

  const how_we_negotiated = [
    "Three agents negotiated at the same time.",
    "We only accept full itemized totals — bait prices never win.",
  ];

  // Confidence: more complete outcomes + clean winner → higher
  let confidence = 40;
  const closed = input.sessions.filter((s) => s.outcome_type).length;
  confidence += closed * 12;
  if (top_pick) confidence += 20;
  if (top_pick && !top_pick.red_flag) confidence += 10;
  if (
    input.tool_calls?.some((t) => t.tool_name === "get_competing_bids")
  ) {
    confidence += 8;
  }
  confidence = Math.min(96, Math.max(25, confidence));

  const headline = top_pick
    ? top_pick.total != null
      ? `Recommended: ${top_pick.vendor_name} at ${formatUsd(top_pick.total)}`
      : `Recommended: ${top_pick.vendor_name}`
    : "No single recommended deal yet";

  return {
    headline,
    top_pick,
    why_top,
    how_others_compared,
    how_we_negotiated,
    confidence,
    verdicts,
    generated_at: new Date().toISOString(),
  };
}

import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { loadVertical, type VerticalConfig } from "@/lib/config/loadVertical";
import { rankQuotes } from "@/lib/tools/rankQuotes";
import { buildLeverageChain } from "@/lib/tools/leverageChain";
import { buildDealReview } from "@/lib/review/dealReview";
import {
  type RankedQuote,
  type Session,
} from "@/lib/types";
import {
  buildBookingRequestDraft,
  questionsBeforeBooking,
} from "@/lib/review/booking";
import { sanitizeTranscriptText } from "@/lib/evidence/transcript";
import { evidencedQuotes } from "@/lib/evidence/quoteEvidence";

type Ctx = { params: Promise<{ id: string }> };

function sessionTerminal(s: Session): boolean {
  return (
    s.status === "closed" ||
    s.status === "error" ||
    s.outcome_type != null
  );
}

/**
 * GET /api/jobs/[id]/state — full state for UI polling (Redis-free).
 * Prefer this every ~1s as SSE backup on multi-instance serverless.
 * Produces deal_review when all sessions closed/error/have outcomes or job complete.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const store = getStore();
    const job = await store.getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const [sessions, quotesRaw, rawTranscripts, tool_calls] = await Promise.all([
      store.listSessionsByJob(id),
      store.listQuotesByJob(id),
      store.listTranscriptsByJob(id, 300),
      store.listToolCallsByJob(id),
    ]);

    let config: VerticalConfig | undefined;
    try {
      config = loadVertical(job.vertical);
    } catch {
      config = undefined;
    }

    const allTerminal =
      sessions.length > 0 && sessions.every(sessionTerminal);
    const shouldReview =
      job.status === "complete" ||
      allTerminal ||
      (sessions.length > 0 &&
        sessions.every(
          (s) =>
            s.outcome_type != null ||
            s.status === "closed" ||
            s.status === "error"
        ));

    // Historical rows may include internal bridge prompts. Never return them
    // to the UI or evidence surface, even if they predate the sanitation fix.
    const transcripts = rawTranscripts.flatMap((event) => {
      const text = sanitizeTranscriptText(event.text);
      return text ? [{ ...event, text }] : [];
    });

    // A logged tool value is not a quote until the provider has spoken it.
    const quotes = evidencedQuotes(quotesRaw, transcripts);

    const ranked: RankedQuote[] = rankQuotes(quotes, config, sessions).map(
      (r) => ({
        ...r,
        leverage_chain: buildLeverageChain({
          session_id: r.session_id,
          quotes,
          tool_calls,
          transcripts,
        }),
      })
    );

    const sessionsEnriched = sessions.map((s) => ({
      ...s,
      competing_bid_used: tool_calls.some(
        (t) =>
          t.session_id === s.id && t.tool_name === "get_competing_bids"
      ),
      current_total: null,
    }));

    const deal_review = shouldReview
      ? buildDealReview({
          job,
          sessions,
          quotes,
          ranked,
          transcripts,
          tool_calls,
        })
      : null;

    const recommended = ranked.find((quote) => quote.is_winner) || ranked[0];
    const recommendedSession = recommended
      ? sessions.find((session) => session.id === recommended.session_id)
      : undefined;
    const recommendedQuote = recommended
      ? quotes.find((quote) => quote.id === recommended.id)
      : undefined;
    const questions_before_booking = config
      ? questionsBeforeBooking({
          vertical: config,
          session: recommendedSession,
          quote: recommendedQuote,
          transcripts,
        })
      : [];
    const booking_request_draft = buildBookingRequestDraft({
      job,
      session: recommendedSession,
      quote: recommendedQuote,
      questions: questions_before_booking,
    });

    return NextResponse.json({
      job,
      sessions: sessionsEnriched,
      quotes,
      transcripts,
      tool_calls,
      ranked,
      deal_review,
      questions_before_booking,
      booking_request_draft,
      all_sessions_terminal: allTerminal,
      polling_ok: true,
      backend: store.backend,
    });
  } catch (e) {
    console.error("[GET /api/jobs/:id/state]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

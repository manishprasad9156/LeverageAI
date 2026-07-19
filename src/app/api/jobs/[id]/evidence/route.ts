import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { loadVertical } from "@/lib/config/loadVertical";
import { rankQuotes } from "@/lib/tools/rankQuotes";
import { buildLeverageChain } from "@/lib/tools/leverageChain";
import {
  buildBookingRequestDraft,
  questionsBeforeBooking,
} from "@/lib/review/booking";
import { getPlaybook } from "@/lib/learning/extract";
import { buildEvidenceBundle } from "@/lib/evidence/bundle";
import { sanitizeTranscriptText } from "@/lib/evidence/transcript";
import { evidencedQuotes } from "@/lib/evidence/quoteEvidence";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  try {
    const { id } = await context.params;
    const store = getStore();
    const job = await store.getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const [sessions, quotesRaw, rawTranscripts, toolCalls, playbook] = await Promise.all([
      store.listSessionsByJob(id),
      store.listQuotesByJob(id),
      store.listTranscriptsByJob(id, 2000),
      store.listToolCallsByJob(id),
      getPlaybook(job.vertical),
    ]);
    const transcripts = rawTranscripts.flatMap((event) => {
      const text = sanitizeTranscriptText(event.text);
      return text ? [{ ...event, text }] : [];
    });
    const quotes = evidencedQuotes(quotesRaw, transcripts);
    const vertical = loadVertical(job.vertical);
    const ranked = rankQuotes(quotes, vertical, sessions).map((quote) => ({
      ...quote,
      leverage_chain: buildLeverageChain({
        session_id: quote.session_id,
        quotes,
        tool_calls: toolCalls,
        transcripts,
      }),
    }));
    const recommended = ranked.find((quote) => quote.is_winner) || ranked[0];
    const recommendedSession = recommended
      ? sessions.find((session) => session.id === recommended.session_id)
      : undefined;
    const recommendedQuote = recommended
      ? quotes.find((quote) => quote.id === recommended.id)
      : undefined;
    const questions = questionsBeforeBooking({
      vertical,
      session: recommendedSession,
      quote: recommendedQuote,
      transcripts,
    });
    const bookingDraft = buildBookingRequestDraft({
      job,
      session: recommendedSession,
      quote: recommendedQuote,
      questions,
    });
    const selected = new Set<string>();
    for (const call of toolCalls) {
      if (call.tool_name !== "learning_selection") continue;
      const tactics = call.payload.selected_tactics;
      if (Array.isArray(tactics)) {
        for (const tactic of tactics) if (typeof tactic === "string") selected.add(tactic);
      }
    }
    const learning = playbook.rows.map((row) => ({
      tactic: row.tactic,
      sample_count: row.sample_count,
      average_price_improvement_pct: Math.max(0, -row.outcome_delta),
      selected_for_this_run: selected.has(row.tactic),
    }));
    const bundle = await buildEvidenceBundle({
      generated_at: new Date().toISOString(),
      vertical_name: vertical.displayName,
      job,
      sessions,
      quotes,
      ranked,
      transcripts,
      questions_before_booking: questions,
      booking_request_draft: bookingDraft,
      learning,
      tool_calls: toolCalls,
      app_origin: request.nextUrl.origin,
    });

    const responseBody = new Uint8Array(bundle.byteLength);
    responseBody.set(bundle);
    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="leverageai-evidence-${id}.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[evidence bundle]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to build evidence bundle" },
      { status: 500 }
    );
  }
}

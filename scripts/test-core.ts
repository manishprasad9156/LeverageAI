import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import JSZip from "jszip";
import { listVerticalIds, loadVertical } from "../src/lib/config/loadVertical";
import { extractJobSpecFromUpload } from "../src/lib/intake/extractJobSpec";
import { validateJobSpec } from "../src/lib/intake/jobSpec";
import { jobSpecFromVoicePayload } from "../src/lib/intake/voicePayload";
import { questionsBeforeBooking } from "../src/lib/review/booking";
import { assessQuoteCompleteness } from "../src/lib/review/quoteEvidence";
import { verifyElevenLabsWebhook } from "../src/lib/security/elevenlabsWebhook";
import { extractLearningsFromSession } from "../src/lib/learning/extract";
import { buildEvidenceBundle } from "../src/lib/evidence/bundle";
import {
  cleanTranscriptEvents,
  enforceNoBookingCommitment,
  sanitizeTranscriptText,
} from "../src/lib/evidence/transcript";
import { evidencedQuotes } from "../src/lib/evidence/quoteEvidence";
import { blobStorageMode } from "../src/lib/storage/blobAuth";

async function main() {
  const ids = listVerticalIds();
  assert.deepEqual(ids, ["auto-repair", "hvac", "medical-imaging", "movers"]);
  for (const id of ids) {
    const vertical = loadVertical(id);
    assert.equal(vertical.vendors.length, 3);
    assert.ok(vertical.quote_line_items.some((item) => item.required));
    assert.ok(vertical.booking_terms.length > 0);
    assert.ok(vertical.provider_search_queries.length > 0);
    const fromVoice = jobSpecFromVoicePayload(vertical, {
      ...vertical.demo_defaults,
      job_spec: {},
    });
    assert.equal(
      validateJobSpec(vertical, fromVoice).ok,
      true,
      `${id} voice payload must populate every required config field`,
    );
  }

  const moverVoice = jobSpecFromVoicePayload(loadVertical("movers"), {
    move_type: "local_apartment",
    from_city: "Chicago",
    to_city: "Evanston",
    bedrooms: 2,
    packing: "none",
    urgency: "within_2_weeks",
    zip: "60614",
  });
  assert.equal(moverVoice.from_city, "Chicago");
  assert.equal(validateJobSpec("movers", moverVoice).ok, true);

  const extraction = await extractJobSpecFromUpload({
    vertical: "hvac",
    text: "My central AC stopped cooling in ZIP 60614 and I need it this week.",
  });
  assert.equal(extraction.job_spec.zip, "60614");
  assert.equal(extraction.job_spec.system_type, "central_ac");
  assert.equal(extraction.job_spec.tonnage, undefined, "must not invent tonnage");
  assert.equal(validateJobSpec("hvac", extraction.job_spec).ok, true);

  const hvac = loadVertical("hvac");
  const complete = assessQuoteCompleteness(hvac, [
    { label: "Equipment", amount: 5000 },
    { label: "Labor and installation", amount: 2500 },
  ]);
  assert.equal(complete.itemized, true);
  assert.deepEqual(complete.missing_required, []);

  const bookingQuestions = questionsBeforeBooking({
    vertical: hvac,
    quote: {
      id: "q1",
      session_id: "s1",
      job_id: "j1",
      vendor_id: "tough",
      line_items: [
        { label: "Equipment", amount: 5000 },
        { label: "Labor and installation", amount: 2500 },
      ],
      total: 7500,
      red_flag: false,
      notes: null,
      created_at: new Date(0).toISOString(),
    },
    transcripts: [],
  });
  assert.ok(bookingQuestions.length > 0, "missing booking terms must become questions");

  const body = JSON.stringify({ type: "post_call_transcription", data: {} });
  const secret = "test-secret";
  const timestamp = 1_700_000_000;
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  assert.deepEqual(
    verifyElevenLabsWebhook({
      rawBody: body,
      signatureHeader: `t=${timestamp},v0=${digest}`,
      secret,
      nowMs: timestamp * 1000,
    }),
    { ok: true },
  );
  assert.equal(
    verifyElevenLabsWebhook({
      rawBody: `${body} `,
      signatureHeader: `t=${timestamp},v0=${digest}`,
      secret,
      nowMs: timestamp * 1000,
    }).ok,
    false,
  );
  assert.equal(
    blobStorageMode({ BLOB_READ_WRITE_TOKEN: "test-token" }),
    "read-write-token",
    "recording persistence must use durable Blob when token is configured",
  );

  const learnings = await extractLearningsFromSession({
    vertical: "hvac",
    transcripts: [
      { speaker: "negotiator", text: "Please itemize every line item.", ts_ms: 1_000 },
      { speaker: "negotiator", text: "I have a competing quote in writing.", ts_ms: 2_000 },
    ],
    priceHistory: [10_000, 9_000],
  });
  assert.equal(learnings.length, 2);
  assert.equal(learnings.find((item) => item.tactic === "cite_competing_bid")?.delta, -10);
  assert.equal(learnings.find((item) => item.tactic === "request_itemization")?.delta, 0);

  const unverifiedLearning = await extractLearningsFromSession({
    vertical: "hvac",
    transcripts: [
      { speaker: "negotiator", text: "I have a competing bid.", ts_ms: 1_000 },
      { speaker: "vendor", text: "I can move from $10,000 to $8,000.", ts_ms: 2_000 },
    ],
    priceHistory: [],
  });
  assert.equal(
    unverifiedLearning.find((item) => item.tactic === "cite_competing_bid")?.delta,
    0,
    "spoken prices must not train the bandit without persisted quote history",
  );
  assert.equal(
    sanitizeTranscriptText("You are on a live call with a vendor dispatcher. Job JSON: {}"),
    null,
    "internal kickoff prompts must never enter evidence",
  );
  assert.match(
    enforceNoBookingCommitment("We'll take it, please schedule the work."),
    /cannot book, purchase, authorize work/i,
  );
  const createdAt = new Date(0).toISOString();
  assert.equal(
    cleanTranscriptEvents([
      { id: 1, session_id: "s-clean", speaker: "vendor", text: "The total is $590.", ts_ms: 1, created_at: createdAt },
      { id: 2, session_id: "s-clean", speaker: "negotiator", text: "The total is $590.", ts_ms: 2, created_at: createdAt },
      { id: 3, session_id: "s-clean", speaker: "vendor", text: "The total is $590...", ts_ms: 3, created_at: createdAt },
    ]).length,
    1,
    "post-call duplicate and truncated transcript rows must not reach the UI",
  );
  const evidenceQuote = {
    id: "q-evidence",
    session_id: "s-evidence",
    job_id: "j1",
    vendor_id: "tough",
    line_items: [{ label: "Labor", amount: 590 }],
    total: 590,
    red_flag: false,
    notes: null,
    created_at: createdAt,
  };
  assert.equal(
    evidencedQuotes([evidenceQuote], []).length,
    0,
    "a tool/session total must not display without provider speech",
  );
  assert.equal(
    evidencedQuotes([evidenceQuote], [{
      id: 1,
      session_id: "s-evidence",
      ts_ms: 1,
      speaker: "vendor",
      text: "The itemized total is $590.",
      created_at: createdAt,
    }]).length,
    1,
  );
  assert.equal(
    evidencedQuotes([evidenceQuote], [{
      id: 2,
      session_id: "s-evidence",
      ts_ms: 2,
      speaker: "vendor",
      text: "The total is five hundred ninety dollars.",
      created_at: createdAt,
    }]).length,
    1,
    "spoken number words must qualify as quote evidence",
  );

  const bundle = await buildEvidenceBundle({
    generated_at: createdAt,
    vertical_name: "HVAC",
    app_origin: "https://example.test",
    job: {
      id: "j1",
      vertical: "hvac",
      job_spec: extraction.job_spec,
      frozen_job_spec: extraction.job_spec,
      status: "complete",
      confirmed: true,
      created_at: createdAt,
    },
    sessions: [],
    quotes: [],
    ranked: [],
    transcripts: [],
    tool_calls: [],
    questions_before_booking: bookingQuestions,
    booking_request_draft: "Evidence request only. No purchase authorization.",
    learning: [],
  });
  const zip = await JSZip.loadAsync(bundle);
  for (const filename of [
    "report.pdf",
    "quotes.json",
    "transcripts.json",
    "transcripts.md",
    "recordings.json",
    "learning-comparison.json",
    "booking-request.txt",
    "manifest.json",
  ]) {
    assert.ok(zip.file(filename), `bundle is missing ${filename}`);
  }
  const pdf = await zip.file("report.pdf")!.async("uint8array");
  assert.equal(new TextDecoder().decode(pdf.slice(0, 4)), "%PDF");

  console.log("CORE TESTS OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

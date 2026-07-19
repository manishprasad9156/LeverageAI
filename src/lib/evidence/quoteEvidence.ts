import type { Quote, TranscriptEvent } from "@/lib/types";

function escapedNumber(total: number): string {
  const rounded = Math.round(total);
  const formatted = rounded.toLocaleString("en-US").replace(/,/g, "[, ]?");
  return `(?:\\$\\s*)?${formatted}(?:\\.00)?(?:\\s*(?:usd|dollars?))?`;
}

/**
 * A commercial total becomes visible only after the provider has actually
 * spoken the same numeric amount in the captured call transcript. A tool call
 * or session.current_total alone is never customer-facing evidence.
 */
export function quoteHasSpokenVendorEvidence(
  quote: Quote,
  transcripts: TranscriptEvent[],
): boolean {
  const amount = new RegExp(`(^|[^0-9])${escapedNumber(quote.total)}($|[^0-9])`, "i");
  return transcripts.some(
    (event) =>
      event.session_id === quote.session_id &&
      event.speaker === "vendor" &&
      amount.test(event.text),
  );
}

export function evidencedQuotes(
  quotes: Quote[],
  transcripts: TranscriptEvent[],
): Quote[] {
  return quotes.filter((quote) => quoteHasSpokenVendorEvidence(quote, transcripts));
}

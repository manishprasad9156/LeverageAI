/** Keep evidence limited to words actually spoken by the two call parties. */
const INTERNAL_PROMPT_MARKERS = [
  "you are on a live call with a vendor dispatcher",
  "sound like a calm buying consultant",
  "required quote categories:",
  "company key:",
  "job json:",
  "counter strategy:",
  "rules: one idea per turn",
  "playbook (soft tactics only",
  "when you have a firm total: log_quote",
  "conversation_initiation_client_data",
  "dynamic_variables",
];

export function sanitizeTranscriptText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text === "…" || text === "...") return null;
  const lower = text.toLowerCase();
  if (INTERNAL_PROMPT_MARKERS.some((marker) => lower.includes(marker))) {
    return null;
  }
  return text.slice(0, 4000);
}

/** Safe for API and client rendering; old persisted rows are cleaned on read. */
export function isDisplayableTranscript(value: unknown): value is string {
  return sanitizeTranscriptText(value) !== null;
}

/** The product may request details, but it never books or accepts work. */
export function enforceNoBookingCommitment(text: string): string {
  if (
    /\b(we(?:'ll| will)? take it|book (?:it|that)|schedule (?:it|that|the)|confirm (?:the )?(?:appointment|booking)|go ahead (?:and|with)|authorize (?:the )?(?:work|job)|start (?:the )?work)\b/i.test(
      text,
    )
  ) {
    return "I cannot book, purchase, authorize work, or confirm an appointment. Please provide the written itemized quote and available callback window for the customer to review.";
  }
  return text;
}

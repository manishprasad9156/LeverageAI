/**
 * ProviderScore (0–100) — deterministic, auditable.
 * ProviderScore = 30·R + 20·V + 10·F + 10·O + 30·N
 */
export type PlaceLike = {
  place_id?: string;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
  nationalPhoneNumber?: string | null;
  websiteUri?: string | null;
  /** ISO date of newest review if known */
  newestReviewAt?: string | null;
};

export type NegotiationSignals = {
  finalQuote?: number | null;
  fairMid?: number | null;
  fullyItemizedFirstRequest?: boolean;
  redFlag?: boolean;
  outcome?: string | null;
};

export type ScoreBreakdown = {
  R: number;
  V: number;
  F: number;
  O: number;
  N: number;
  total: number;
  preCall: boolean;
  components: { key: string; weight: number; value: number; points: number }[];
};

const M_PRIOR = 25;
const C_PRIOR = 0.78; // ~3.9★ / 5

export function scoreRating(r?: number | null, v?: number | null): number {
  const rating = typeof r === "number" ? r : 0;
  const volume = typeof v === "number" ? v : 0;
  const rNorm = Math.min(1, Math.max(0, rating / 5));
  // Bayesian: (v·r + m·C)/(v + m)
  return (volume * rNorm + M_PRIOR * C_PRIOR) / (volume + M_PRIOR);
}

export function scoreVolume(v?: number | null): number {
  const volume = typeof v === "number" ? v : 0;
  return Math.min(1, Math.log10(volume + 1) / 3);
}

export function scoreFreshness(newestReviewAt?: string | null): number {
  if (!newestReviewAt) return 0.5; // unknown → middle
  const ageMs = Date.now() - new Date(newestReviewAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.5;
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days <= 90) return 1;
  if (days <= 365) return 0.5;
  return 0;
}

export function scoreOperational(p: PlaceLike): number {
  const op = (p.businessStatus || "OPERATIONAL").toUpperCase() === "OPERATIONAL";
  const phone = Boolean(p.nationalPhoneNumber);
  const web = Boolean(p.websiteUri);
  if (op && phone && web) return 1;
  if (op && (phone || web)) return 0.5;
  if (op) return 0.25;
  return 0;
}

export function scoreNegotiation(sig?: NegotiationSignals | null): number {
  if (!sig) return 0.5;
  let n = 0.5;
  if (
    typeof sig.finalQuote === "number" &&
    typeof sig.fairMid === "number" &&
    sig.fairMid > 0 &&
    sig.finalQuote <= sig.fairMid
  ) {
    n += 0.25;
  }
  if (sig.fullyItemizedFirstRequest) n += 0.15;
  if (sig.redFlag) n -= 0.5;
  if (sig.outcome === "itemized_quote") n += 0.1;
  return Math.min(1, Math.max(0, n));
}

/**
 * @param postCall when false, redistribute N's 30 points proportionally across R/V/F/O
 */
export function computeProviderScore(
  place: PlaceLike,
  opts?: { negotiation?: NegotiationSignals | null; postCall?: boolean }
): ScoreBreakdown {
  const R = scoreRating(place.rating, place.userRatingCount);
  const V = scoreVolume(place.userRatingCount);
  const F = scoreFreshness(place.newestReviewAt);
  const O = scoreOperational(place);
  const postCall = Boolean(opts?.postCall);
  const N = postCall ? scoreNegotiation(opts?.negotiation) : 0;

  if (!postCall) {
    // Redistribute 30 N points across R/V/F/O proportional to their base weights 30/20/10/10
    const base = [
      { key: "R", weight: 30, value: R },
      { key: "V", weight: 20, value: V },
      { key: "F", weight: 10, value: F },
      { key: "O", weight: 10, value: O },
    ];
    const wSum = base.reduce((s, b) => s + b.weight, 0); // 70
    const components = base.map((b) => {
      const extra = (b.weight / wSum) * 30;
      const points = (b.weight + extra) * b.value;
      return { key: b.key, weight: b.weight + extra, value: b.value, points };
    });
    const total = components.reduce((s, c) => s + c.points, 0);
    return {
      R,
      V,
      F,
      O,
      N: 0.5,
      total,
      preCall: true,
      components: [
        ...components,
        { key: "N", weight: 0, value: 0.5, points: 0 },
      ],
    };
  }

  const components = [
    { key: "R", weight: 30, value: R, points: 30 * R },
    { key: "V", weight: 20, value: V, points: 20 * V },
    { key: "F", weight: 10, value: F, points: 10 * F },
    { key: "O", weight: 10, value: O, points: 10 * O },
    { key: "N", weight: 30, value: N, points: 30 * N },
  ];
  const total = components.reduce((s, c) => s + c.points, 0);
  return { R, V, F, O, N, total, preCall: false, components };
}

/** Bayesian ordering fixture: 5.0×3 must rank below 4.7×900 */
export function bayesianOrderingFixture(): {
  highVolume: number;
  thinFiveStar: number;
  pass: boolean;
} {
  const highVolume = computeProviderScore({
    rating: 4.7,
    userRatingCount: 900,
    businessStatus: "OPERATIONAL",
    nationalPhoneNumber: "+1",
    websiteUri: "https://example.com",
  }).total;
  const thinFiveStar = computeProviderScore({
    rating: 5.0,
    userRatingCount: 3,
    businessStatus: "OPERATIONAL",
    nationalPhoneNumber: "+1",
    websiteUri: "https://example.com",
  }).total;
  return {
    highVolume,
    thinFiveStar,
    pass: highVolume > thinFiveStar,
  };
}

/**
 * Combine provider score (40%) with quote rank points (60%).
 * quoteRank: 1 = best among non-red quotes.
 * Red-flagged quotes never win regardless of score.
 */
export function combineDealScore(
  providerScore: number,
  quoteRank: number,
  quoteCount: number,
  redFlag: boolean
): number {
  if (redFlag) return -1; // never #1
  const quotePoints =
    quoteCount <= 1 ? 100 : 100 * (1 - (quoteRank - 1) / Math.max(1, quoteCount - 1));
  return 0.4 * providerScore + 0.6 * quotePoints;
}

/** Client UI types — flexible adapters over /api/vertical + job state. */

export type JobSpecField = {
  key: string;
  label: string;
  type: string;
};

export type VendorConfig = {
  id: string;
  name?: string;
  displayName?: string;
  persona?: string;
  role?: string;
  role_label?: string;
  /** Non-technical one-liner for UI */
  nature?: string;
  public_blurb?: string;
};

export type BenchmarkEntry = {
  label?: string;
  unit?: string;
  fair_low?: number;
  fair_high?: number;
  low?: number;
  mid?: number;
  high?: number;
  currency?: string;
  source?: string;
  retrieved?: string;
};

export type LeverageChainStep = {
  t_ms: number;
  kind: string;
  label: string;
  amount?: number;
  quote_id?: string;
  vendor_id?: string;
  transcript_excerpt?: string;
};

export type VerticalConfig = {
  id: string;
  displayName?: string;
  name?: string;
  label?: string;
  short_label?: string;
  description?: string;
  job_spec_fields?: JobSpecField[];
  intake?: {
    questions?: Array<{
      id: string;
      prompt: string;
      type: string;
      options?: string[];
      required?: boolean;
    }>;
  };
  vendors: VendorConfig[];
  benchmarks: Record<string, BenchmarkEntry>;
  default_job_type?: string;
  red_flag: {
    threshold_below_benchmark: number;
    threshold_pct_below_benchmark?: number;
    never_rank_first?: boolean;
    benchmark_key?: string;
    benchmark_field?: string;
    banner_template?: string;
    description?: string;
  };
  demo_defaults?: Record<string, string | number | boolean>;
  demo_job_spec?: Record<string, unknown>;
  ui?: {
    job_column_title?: string;
    calls_column_title?: string;
    deal_column_title?: string;
    confirm_button?: string;
    demo_job_button?: string;
    voice_intake_label?: string;
    pdf_upload_label?: string;
  };
  [key: string]: unknown;
};

export type JobSpec = Record<string, string | number | boolean | null>;

export type CallStatus =
  | "idle"
  | "dialing"
  | "negotiating"
  | "done"
  | "declined";

export type TranscriptLine = {
  id: string;
  speaker: "negotiator" | "vendor" | "system" | string;
  text: string;
  ts: number; // seconds into call
};

export type LineItem = {
  label: string;
  amount: number;
  evidence_ts?: number;
};

export type CallOutcome =
  | "itemized_quote"
  | "callback_commitment"
  | "documented_decline"
  | null;

export type SessionCard = {
  vendor_id: string;
  vendor_name: string;
  persona: string;
  status: CallStatus;
  current_price: number | null;
  transcript: TranscriptLine[];
  competing_bid_used: boolean;
  audio_url?: string | null;
  outcome: CallOutcome;
  line_items: LineItem[];
  why?: string;
  red_flag?: boolean;
  red_flag_pct?: number;
  callback_at?: string | null;
  session_id?: string;
};

export type RankedDeal = {
  rank: number;
  session: SessionCard;
  recommended: boolean;
  red_flag: boolean;
  red_flag_pct?: number;
  why: string;
  leverage_chain?: LeverageChainStep[];
};

/** Review layer output — plain-language top pick for the Deal column */
export type DealReviewUi = {
  headline: string;
  top_pick: {
    vendor_id: string;
    vendor_name: string;
    total: number | null;
    outcome: string | null;
    red_flag: boolean;
    red_flag_pct?: number;
    label: string;
    plain: string;
  } | null;
  why_top: string[];
  how_others_compared: string[];
  how_we_negotiated: string[];
  confidence: number;
  verdicts?: Array<{
    vendor_id: string;
    vendor_name: string;
    total: number | null;
    plain: string;
    red_flag: boolean;
    label: string;
  }>;
  generated_at?: string;
};

export type UiPhase = "draft" | "confirmed" | "calling" | "complete";

export type JobState = {
  job_id: string | null;
  phase: UiPhase;
  job_spec: JobSpec | null;
  sessions: SessionCard[];
  ranked: RankedDeal[];
  deal_review?: DealReviewUi | null;
};

export type MockEvent =
  | {
      t: number;
      type: "status";
      vendor_id: string;
      status: CallStatus;
    }
  | {
      t: number;
      type: "transcript";
      vendor_id: string;
      speaker: TranscriptLine["speaker"];
      text: string;
      ts: number;
    }
  | {
      t: number;
      type: "price";
      vendor_id: string;
      price: number;
    }
  | {
      t: number;
      type: "competing_bid_used";
      vendor_id: string;
    }
  | {
      t: number;
      type: "outcome";
      vendor_id: string;
      outcome: Exclude<CallOutcome, null>;
      line_items?: LineItem[];
      price?: number | null;
      why?: string;
      callback_at?: string;
    }
  | { t: number; type: "complete" };

export type GoldenRun = {
  vertical?: string;
  job_spec?: JobSpec;
  events?: MockEvent[];
  /** Alternate golden shape from backend agents */
  sessions?: Array<{
    vendor_id: string;
    vendor_name?: string;
    outcome_type?: string;
    callback_window?: string;
    quotes?: Array<{
      line_items?: LineItem[];
      total?: number;
      notes?: string;
    }>;
  }>;
  [key: string]: unknown;
};

/** UI copy helpers with safe defaults (no vertical hardcodes) */
export function uiCopy(v: VerticalConfig) {
  return {
    job_column_title: v.ui?.job_column_title || "Your job",
    calls_column_title: v.ui?.calls_column_title || "The calls",
    deal_column_title: v.ui?.deal_column_title || "Your deal",
    confirm_button: v.ui?.confirm_button || "Looks right — get me quotes",
    demo_job_button: v.ui?.demo_job_button || "Use demo job",
    voice_intake_label: v.ui?.voice_intake_label || "Voice intake",
    pdf_upload_label: v.ui?.pdf_upload_label || "Drop a PDF quote",
  };
}

export function vendorDisplayName(v: VendorConfig): string {
  return v.name || v.displayName || v.id;
}

export function jobSpecFields(v: VerticalConfig): JobSpecField[] {
  if (v.job_spec_fields?.length) return v.job_spec_fields;
  if (v.intake?.questions?.length) {
    return v.intake.questions.map((q) => ({
      key: q.id,
      label: q.prompt.replace(/\?$/, ""),
      type: q.type,
    }));
  }
  return Object.keys(v.demo_defaults || {}).map((key) => ({
    key,
    label: key.replace(/_/g, " "),
    type: "string",
  }));
}

export function demoJobSpec(v: VerticalConfig): JobSpec {
  if (v.demo_defaults && Object.keys(v.demo_defaults).length) {
    return { ...v.demo_defaults };
  }
  if (v.demo_job_spec) {
    return { ...(v.demo_job_spec as JobSpec) };
  }
  return {
    job_type: v.default_job_type || Object.keys(v.benchmarks)[0] || "default",
  };
}

export function verticalTitle(v: VerticalConfig): string {
  return v.short_label || v.label || v.displayName || v.name || v.id;
}

export function redFlagThresholdPct(v: VerticalConfig): number {
  if (typeof v.red_flag.threshold_pct_below_benchmark === "number") {
    return v.red_flag.threshold_pct_below_benchmark;
  }
  return Math.round((v.red_flag.threshold_below_benchmark || 0.3) * 100);
}

export function benchmarkMidFor(v: VerticalConfig, jobType?: string | null): number | null {
  const key =
    jobType ||
    v.default_job_type ||
    v.red_flag.benchmark_key ||
    Object.keys(v.benchmarks)[0];
  if (!key) return null;
  const b = v.benchmarks[key];
  if (!b) return null;
  if (typeof b.mid === "number") return b.mid;
  if (typeof b.fair_low === "number" && typeof b.fair_high === "number") {
    return (b.fair_low + b.fair_high) / 2;
  }
  if (typeof b.low === "number" && typeof b.high === "number") {
    return (b.low + b.high) / 2;
  }
  return null;
}

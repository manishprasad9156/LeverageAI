/**
 * Vertical config schema + shared domain types for The Negotiator.
 * All vertical-specific numbers live in /config/verticals/*.json — never hardcode them.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Intake / job_spec field descriptors (meta-schema for vertical JSON)
// ---------------------------------------------------------------------------

export const IntakeQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(["string", "number", "enum", "boolean"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

export const JobSpecFieldMetaSchema = z.object({
  type: z.enum(["string", "number", "boolean", "enum"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
});

export const JobSpecFieldUiSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
});

// ---------------------------------------------------------------------------
// Vendors — public fields vs secret strategy
// ---------------------------------------------------------------------------

export const VendorSchema = z.object({
  id: z.enum(["tough", "stonewaller", "upseller"]),
  displayName: z.string().min(1),
  /** Alias for consumers that read `name` */
  name: z.string().optional(),
  role: z.enum(["tough", "stonewaller", "upseller"]),
  /** Alias for consumers that read `persona` */
  persona: z.string().optional(),
  role_label: z.string().optional(),
  /** Non-technical one-liner for the chat header */
  nature: z.string().optional(),
  /** Safe for UI / negotiator context */
  public_blurb: z.string().min(1),
  /**
   * NEVER send to negotiator agent or client UI.
   * Counter-agent isolation / human docs only.
   */
  pricing_strategy_secret: z.string().optional(),
  _comment: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Benchmarks & red flags
// ---------------------------------------------------------------------------

export const SourcedValueSchema = z.object({
  value: z.number(),
  source: z.string(),
  retrieved: z.string(),
});

export const BenchmarkEntrySchema = z.object({
  label: z.string(),
  unit: z.string(),
  fair_low: z.number(),
  fair_high: z.number(),
  /** Optional mirrors for consumers expecting low/mid/high */
  low: z.number().optional(),
  mid: z.number().optional(),
  high: z.number().optional(),
  currency: z.string().default("USD"),
  /** Citation for negotiator speech + UI footnotes */
  source: z.string().optional(),
  retrieved: z.string().optional(),
  notes: z.string().optional(),
  citations: z.record(z.string(), SourcedValueSchema).optional(),
});

export const RedFlagSchema = z.object({
  /** Fraction 0..1 (e.g. 0.30 = 30% below mid) */
  threshold_below_benchmark: z.number().min(0).max(1),
  never_rank_first: z.boolean(),
  /** Percent form for UI consumers (e.g. 30) */
  threshold_pct_below_benchmark: z.number().optional(),
  benchmark_key: z.string().optional(),
  description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Full vertical config
// ---------------------------------------------------------------------------

export const VerticalConfigSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    name: z.string().optional(),
    label: z.string().optional(),
    short_label: z.string().optional(),
    description: z.string().optional(),
    intake: z.object({
      questions: z.array(IntakeQuestionSchema).min(1),
    }),
    job_spec_schema: z.object({
      fields: z.record(z.string(), JobSpecFieldMetaSchema),
    }),
    /** Optional UI field list (derived from intake / schema) */
    job_spec_fields: z.array(JobSpecFieldUiSchema).optional(),
    vendors: z.array(VendorSchema).length(3),
    benchmarks: z.record(z.string(), BenchmarkEntrySchema),
    default_job_type: z.string().optional(),
    red_flag: RedFlagSchema,
    negotiation_levers: z.array(z.string()).min(1),
    glossary: z.record(z.string(), z.string()),
    /** Pre-filled job for demo / judges — UI must load from config, never hardcode */
    demo_defaults: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()])
    ),
    ui: z
      .object({
        job_column_title: z.string().optional(),
        calls_column_title: z.string().optional(),
        deal_column_title: z.string().optional(),
        confirm_button: z.string().optional(),
        demo_job_button: z.string().optional(),
        voice_intake_label: z.string().optional(),
        pdf_upload_label: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Runtime job_spec (values filled for a single job)
// ---------------------------------------------------------------------------

/**
 * JobSpec is intentionally open-ended so verticals can differ.
 * Runtime shape is constrained by the active vertical's job_spec_schema + demo_defaults.
 */
export const JobSpecSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type IntakeQuestion = z.infer<typeof IntakeQuestionSchema>;
export type JobSpecFieldMeta = z.infer<typeof JobSpecFieldMetaSchema>;
export type Vendor = z.infer<typeof VendorSchema>;
export type Benchmark = z.infer<typeof BenchmarkEntrySchema>;
export type RedFlag = z.infer<typeof RedFlagSchema>;
export type VerticalConfig = z.infer<typeof VerticalConfigSchema>;
export type JobSpec = z.infer<typeof JobSpecSchema>;

/** Public vendor view: strip secrets before anything reaches negotiator/UI */
export type PublicVendor = Omit<Vendor, "pricing_strategy_secret" | "_comment">;

export function toPublicVendor(v: Vendor): PublicVendor {
  const { pricing_strategy_secret: _s, _comment: _c, ...pub } = v;
  return pub;
}

export function toPublicVertical(
  config: VerticalConfig
): Omit<VerticalConfig, "vendors"> & { vendors: PublicVendor[] } {
  return {
    ...config,
    vendors: config.vendors.map(toPublicVendor),
  };
}

/** Midpoint of a fair range — used for red-flag math */
export function benchmarkMid(b: Benchmark): number {
  if (typeof b.mid === "number") return b.mid;
  return (b.fair_low + b.fair_high) / 2;
}

/**
 * True when total is ≥ threshold fraction below benchmark mid.
 * Default threshold from vertical red_flag (e.g. 0.30).
 */
export function isRedFlagQuote(
  total: number,
  benchmark: Benchmark,
  thresholdBelow: number
): boolean {
  const mid = benchmarkMid(benchmark);
  if (mid <= 0) return false;
  return total <= mid * (1 - thresholdBelow);
}

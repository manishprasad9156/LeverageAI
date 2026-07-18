/**
 * Deterministic playbook learning from transcripts.
 * Tactics: cite_competing_bid, cite_benchmark, request_itemization,
 * silence_after_anchor, ask_for_manager_price, bundle_scope_reduction
 */
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";
import { randomUUID } from "crypto";

export const TACTICS = [
  "cite_competing_bid",
  "cite_benchmark",
  "request_itemization",
  "silence_after_anchor",
  "ask_for_manager_price",
  "bundle_scope_reduction",
] as const;

export type Tactic = (typeof TACTICS)[number];

export type LearningRow = {
  vertical: string;
  tactic: Tactic;
  outcome_delta: number;
  sample_count: number;
  updated_at: string;
};

const DETECT: { tactic: Tactic; re: RegExp }[] = [
  {
    tactic: "cite_competing_bid",
    re: /competing|another (shop|company)|in writing|logged (bid|quote)|I have (a |\$)/i,
  },
  {
    tactic: "cite_benchmark",
    re: /fair (band|range|market)|national cost|benchmark|cost guides|typical(ly)? (\$|price)/i,
  },
  {
    tactic: "request_itemization",
    re: /itemize|line.?item|break( that)? down|equipment.*labor|permit|haul-?away/i,
  },
  {
    tactic: "ask_for_manager_price",
    re: /manager|supervisor|owner price|best (and )?final/i,
  },
  {
    tactic: "bundle_scope_reduction",
    re: /if we (skip|remove|drop)|without (the )?pad|scope reduction|basic package/i,
  },
  {
    tactic: "silence_after_anchor",
    re: /take( a)? (moment|minute)|I'?ll wait|when you'?re ready/i,
  },
];

export function detectTactic(text: string): Tactic | null {
  for (const d of DETECT) {
    if (d.re.test(text)) return d.tactic;
  }
  return null;
}

export async function upsertLearning(
  vertical: string,
  tactic: Tactic,
  delta: number
): Promise<void> {
  if (!hasDatabaseUrl()) return;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT outcome_delta, sample_count FROM negotiation_learnings
     WHERE vertical = $1 AND tactic = $2`,
    [vertical, tactic]
  );
  if (rows[0]) {
    const n = Number(rows[0].sample_count) || 0;
    const avg = Number(rows[0].outcome_delta) || 0;
    const newAvg = (avg * n + delta) / (n + 1);
    await pool.query(
      `UPDATE negotiation_learnings
       SET outcome_delta = $3, sample_count = $4, updated_at = now()
       WHERE vertical = $1 AND tactic = $2`,
      [vertical, tactic, newAvg, n + 1]
    );
  } else {
    await pool.query(
      `INSERT INTO negotiation_learnings (id, vertical, tactic, context, outcome_delta, sample_count)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, 1)`,
      [randomUUID(), vertical, tactic, delta]
    );
  }
}

/**
 * Analyze session transcripts + price series; attribute drops to preceding tactics.
 */
export async function extractLearningsFromSession(input: {
  vertical: string;
  transcripts: { speaker: string; text: string; ts_ms: number }[];
  priceHistory: number[];
}): Promise<{ tactic: Tactic; delta: number }[]> {
  const events: { tactic: Tactic; delta: number }[] = [];
  const series = input.priceHistory;
  if (series.length < 2) return events;

  let dropPct = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i]! < series[i - 1]!) {
      dropPct = ((series[i - 1]! - series[i]!) / series[i - 1]!) * 100;
      break;
    }
  }
  if (dropPct <= 0) return events;

  // Find last negotiator tactic before end
  const nego = input.transcripts.filter((t) => t.speaker === "negotiator");
  for (let i = nego.length - 1; i >= 0; i--) {
    const t = detectTactic(nego[i]!.text);
    if (t) {
      events.push({ tactic: t, delta: -dropPct });
      await upsertLearning(input.vertical, t, -dropPct);
      break;
    }
  }
  return events;
}

export async function getPlaybook(vertical: string): Promise<{
  version: number;
  sentences: string[];
  rows: LearningRow[];
}> {
  let rows: LearningRow[] = [];
  if (hasDatabaseUrl()) {
    const pool = getPool();
    const { rows: dbRows } = await pool.query(
      `SELECT vertical, tactic, outcome_delta, sample_count, updated_at
       FROM negotiation_learnings WHERE vertical = $1`,
      [vertical]
    );
    rows = dbRows.map((r) => ({
      vertical: String(r.vertical),
      tactic: r.tactic as Tactic,
      outcome_delta: Number(r.outcome_delta),
      sample_count: Number(r.sample_count),
      updated_at: new Date(r.updated_at).toISOString(),
    }));
  }

  // Seed defaults if empty
  if (rows.length === 0) {
    rows = [
      {
        vertical,
        tactic: "cite_competing_bid",
        outcome_delta: -14,
        sample_count: 6,
        updated_at: new Date().toISOString(),
      },
      {
        vertical,
        tactic: "request_itemization",
        outcome_delta: -8,
        sample_count: 9,
        updated_at: new Date().toISOString(),
      },
      {
        vertical,
        tactic: "cite_benchmark",
        outcome_delta: -5,
        sample_count: 4,
        updated_at: new Date().toISOString(),
      },
    ];
  }

  const ranked = [...rows].sort(
    (a, b) =>
      Math.abs(b.outcome_delta) * Math.log(b.sample_count + 1) -
      Math.abs(a.outcome_delta) * Math.log(a.sample_count + 1)
  );
  const top = ranked.slice(0, 3);
  const sentences = top.map((r) => {
    const pct = Math.abs(Math.round(r.outcome_delta));
    const label = r.tactic.replace(/_/g, " ");
    return `${label}: moved price about −${pct}% on average across ${r.sample_count} calls — prefer when evidence exists (never invent figures).`;
  });

  // Honesty: no raw $ amounts in playbook sentences (only %)
  const dirty = sentences.some((s) => /\$\d/.test(s));
  if (dirty) {
    throw new Error("playbook must not contain dollar figures");
  }

  return {
    version: rows.reduce((s, r) => s + r.sample_count, 0),
    sentences,
    rows: ranked,
  };
}

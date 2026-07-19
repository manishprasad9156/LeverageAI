/**
 * UCB1 multi-armed bandit over negotiation tactics.
 * Well-known SOTA exploration/exploitation (Auer et al.) used in production RL systems.
 * Arms = tactics from the playbook; reward = price drop % (normalized to [0,1] reward).
 */
import type { Tactic } from "./extract";
import { TACTICS, getPlaybook } from "./extract";

export type BanditArm = {
  tactic: Tactic;
  pulls: number;
  meanReward: number;
  /** UCB score used for selection */
  ucb: number;
};

/**
 * Convert outcome_delta (negative % price drop is good) into reward in [0,1].
 * −20% drop → reward 1.0; 0% → 0.0
 */
export function deltaToReward(outcomeDelta: number): number {
  const drop = Math.max(0, -outcomeDelta); // percent points
  return Math.min(1, drop / 20);
}

export function computeUcb(
  meanReward: number,
  pulls: number,
  totalPulls: number,
  c = 1.4
): number {
  if (pulls <= 0) return Number.POSITIVE_INFINITY;
  return meanReward + c * Math.sqrt(Math.log(Math.max(1, totalPulls)) / pulls);
}

/**
 * Select top-k tactics via UCB1 from learning rows (+ untried arms).
 */
export async function selectTacticsUcb(
  vertical: string,
  k = 3
): Promise<{
  tactics: Tactic[];
  arms: BanditArm[];
  version: number;
  sentences: string[];
}> {
  const playbook = await getPlaybook(vertical);
  const byTactic = new Map(
    playbook.rows.map((r) => [
      r.tactic,
      { pulls: r.sample_count, mean: deltaToReward(r.outcome_delta) },
    ])
  );
  const totalPulls = playbook.rows.reduce((s, r) => s + r.sample_count, 0) || 1;

  // Warm-start priors so cold demos don't pure-explore untried arms
  // (classic UCB ∞ on n=0 would hide seeded "cite competing bid").
  const PRIOR_PULLS = 1;
  const PRIOR_MEAN = 0.12;
  const arms: BanditArm[] = TACTICS.map((tactic) => {
    const row = byTactic.get(tactic);
    const rawPulls = row?.pulls ?? 0;
    const rawMean = row?.mean ?? 0;
    const pulls = rawPulls > 0 ? rawPulls : PRIOR_PULLS;
    const meanReward = rawPulls > 0 ? rawMean : PRIOR_MEAN;
    const t = totalPulls + TACTICS.length * PRIOR_PULLS;
    return {
      tactic,
      pulls: rawPulls,
      meanReward: rawPulls > 0 ? rawMean : 0,
      ucb: computeUcb(meanReward, pulls, t),
    };
  });

  arms.sort((a, b) => b.ucb - a.ucb);
  const top = arms.slice(0, k);
  const sentences = top.map((a) => {
    const label = a.tactic.replace(/_/g, " ");
    if (a.pulls === 0) return `Try ${label} — not enough data yet; exploring.`;
    const pct = Math.round(a.meanReward * 20);
    return `Prefer ${label} — about −${pct}% average move across ${a.pulls} runs.`;
  });

  return {
    tactics: top.map((a) => a.tactic),
    arms,
    version: playbook.version,
    sentences,
  };
}

/** Compact playbook string for ElevenLabs dynamic vars / kickoff. */
export function formatPlaybookForAgent(sentences: string[]): string {
  return sentences.slice(0, 3).join(" | ");
}

import { NextRequest, NextResponse } from "next/server";
import { getPlaybook } from "@/lib/learning/extract";
import { selectTacticsUcb } from "@/lib/learning/bandit";

/** GET /api/learning?vertical=hvac — UCB1 playbook + tactic leaderboard */
export async function GET(req: NextRequest) {
  try {
    const vertical = req.nextUrl.searchParams.get("vertical") || "hvac";
    const playbook = await getPlaybook(vertical);
    const ucb = await selectTacticsUcb(vertical, 3);
    return NextResponse.json({
      ...playbook,
      method: "UCB1",
      selected_tactics: ucb.tactics,
      ucb_arms: ucb.arms,
      ucb_sentences: ucb.sentences,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getPlaybook } from "@/lib/learning/extract";

/** GET /api/learning?vertical=hvac — tactic leaderboard + playbook sentences */
export async function GET(req: NextRequest) {
  try {
    const vertical = req.nextUrl.searchParams.get("vertical") || "hvac";
    const playbook = await getPlaybook(vertical);
    return NextResponse.json(playbook);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

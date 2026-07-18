import { NextRequest, NextResponse } from "next/server";
import { getIntakeDraft, getLatestFilled } from "@/lib/intake/draftStore";

/** GET /api/intake/status?intake_id=...&vertical=hvac */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("intake_id");
    const vertical = req.nextUrl.searchParams.get("vertical") || "hvac";
    if (id) {
      return NextResponse.json({ draft: await getIntakeDraft(id) });
    }
    return NextResponse.json({ draft: await getLatestFilled(vertical) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed", draft: null },
      { status: 500 }
    );
  }
}

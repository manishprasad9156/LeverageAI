import { NextRequest, NextResponse } from "next/server";
import { getIntakeDraft, getLatestFilled } from "@/lib/intake/draftStore";

/** GET /api/intake/status?intake_id=...&vertical=hvac — UI poll (no webhook auth) */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("intake_id");
  const vertical = req.nextUrl.searchParams.get("vertical") || "hvac";
  if (id) {
    return NextResponse.json({ draft: getIntakeDraft(id) });
  }
  return NextResponse.json({ draft: getLatestFilled(vertical) });
}

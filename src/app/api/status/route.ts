import { NextResponse } from "next/server";
import { isLiveModeEnabled, liveModeStatus } from "@/lib/elevenlabs/liveMode";
import { hasDatabaseUrl } from "@/lib/db/pool";

/** GET /api/status — health for judges UI */
export async function GET() {
  return NextResponse.json({
    ok: true,
    live_mode: isLiveModeEnabled(),
    database: hasDatabaseUrl(),
    places: Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim()),
    details: liveModeStatus(),
  });
}

/**
 * When TOOLS_WEBHOOK_SECRET is set, require matching header on /api/tools/*.
 * Accepts (any one):
 *   x-tools-secret: <secret>
 *   x-leverageai-secret: <secret>
 *   x-tools-webhook-secret: <secret>
 *   Authorization: Bearer <secret>
 */
import { NextRequest, NextResponse } from "next/server";

export function requireToolWebhookAuth(
  req: NextRequest
): NextResponse | null {
  const secret = process.env.TOOLS_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return null;
  }

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const headerSecret =
    req.headers.get("x-tools-secret") ||
    req.headers.get("x-leverageai-secret") ||
    req.headers.get("x-tools-webhook-secret") ||
    "";

  if (bearer === secret || headerSecret === secret) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Unauthorized tool webhook — missing or invalid x-tools-secret",
      code: "UNAUTHORIZED",
    },
    { status: 401 }
  );
}

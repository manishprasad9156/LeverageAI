import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { blobStorageMode } from "@/lib/storage/blobAuth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ sessionId: string }> };

/** Stream a private recording without exposing a Blob credential or URL. */
export async function GET(_request: Request, context: Ctx) {
  const { sessionId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return NextResponse.json({ error: "Invalid recording id" }, { status: 400 });
  }
  const mode = blobStorageMode();
  if (!mode) return NextResponse.json({ error: "Recording storage unavailable" }, { status: 404 });
  try {
    const result = await get(`recordings/${sessionId}.mp3`, {
      access: "private",
      ...(mode === "read-write-token"
        ? { token: process.env.BLOB_READ_WRITE_TOKEN!.trim() }
        : { storeId: process.env.BLOB_STORE_ID!.trim() }),
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.warn("[recording stream]", error);
    return NextResponse.json({ error: "Recording unavailable" }, { status: 404 });
  }
}

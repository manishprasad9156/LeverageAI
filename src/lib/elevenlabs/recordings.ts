/**
 * Fetch conversation audio after a live session.
 * Priority: @vercel/blob put() if BLOB_READ_WRITE_TOKEN → local /public/recordings → transcript-only note.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getElevenLabsApiKey } from "./env";
import { getStore } from "@/lib/db";

const API = "https://api.elevenlabs.io/v1";

async function putVercelBlob(
  sessionId: string,
  buf: Buffer
): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;
  try {
    const { put } = await import("@vercel/blob");
    const blob = await put(`recordings/${sessionId}.mp3`, buf, {
      access: "public",
      token,
      contentType: "audio/mpeg",
    });
    return blob.url;
  } catch (e) {
    console.warn("[recordings] @vercel/blob put failed", e);
    return null;
  }
}

export async function fetchAndStoreRecording(
  sessionId: string,
  conversationId: string
): Promise<{ audio_url: string | null; meta: unknown }> {
  const key = getElevenLabsApiKey();
  const store = getStore();

  let meta: unknown = null;
  try {
    const metaRes = await fetch(
      `${API}/convai/conversations/${conversationId}`,
      { headers: { "xi-api-key": key } }
    );
    if (metaRes.ok) meta = await metaRes.json();
  } catch {
    /* optional */
  }

  let audio_url: string | null = null;
  let recording_note: string | null =
    "Recording available in live mode only — transcript shown.";

  try {
    const audioRes = await fetch(
      `${API}/convai/conversations/${conversationId}/audio`,
      { headers: { "xi-api-key": key } }
    );
    if (audioRes.ok) {
      const buf = Buffer.from(await audioRes.arrayBuffer());
      const blobUrl = await putVercelBlob(sessionId, buf);
      if (blobUrl) {
        audio_url = blobUrl;
        recording_note = null;
      } else if (process.env.VERCEL !== "1") {
        const dir = join(process.cwd(), "public", "recordings");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${sessionId}.mp3`), buf);
        audio_url = `/recordings/${sessionId}.mp3`;
        recording_note = null;
      } else {
        recording_note =
          "Transcript only — set BLOB_READ_WRITE_TOKEN for audio on Vercel";
      }
    }
  } catch (e) {
    console.warn("[recordings] audio fetch failed", e);
  }

  await store.updateSession(sessionId, { audio_url, recording_note });
  return { audio_url, meta };
}

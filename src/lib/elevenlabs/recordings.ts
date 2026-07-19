/**
 * Fetch conversation audio after a live session.
 * Priority: @vercel/blob via short-lived Vercel OIDC or a legacy read/write
 * token → local /public/recordings → transcript-only note.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getElevenLabsApiKey } from "./env";
import { getStore } from "@/lib/db";
import { blobStorageMode } from "@/lib/storage/blobAuth";

const API = "https://api.elevenlabs.io/v1";

async function putVercelBlob(
  sessionId: string,
  buf: Buffer
): Promise<string | null> {
  const mode = blobStorageMode();
  if (!mode) return null;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  try {
    const { put } = await import("@vercel/blob");
    await put(`recordings/${sessionId}.mp3`, buf, {
      // The configured store is private. Playback is served through our
      // recording route, which keeps the Blob token on the server.
      access: "private",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(mode === "read-write-token"
        ? { token }
        : { storeId: process.env.BLOB_STORE_ID!.trim() }),
    });
    return `/api/recordings/${sessionId}`;
  } catch (e) {
    console.warn("[recordings] @vercel/blob put failed", e);
    return null;
  }
}

export async function storeRecordingBuffer(
  sessionId: string,
  buf: Buffer
): Promise<string | null> {
  const store = getStore();
  const blobUrl = await putVercelBlob(sessionId, buf);
  if (blobUrl) {
    await store.updateSession(sessionId, {
      audio_url: blobUrl,
      recording_note: null,
    });
    return blobUrl;
  }

  if (process.env.VERCEL !== "1") {
    const dir = join(process.cwd(), "public", "recordings");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.mp3`), buf);
    const localUrl = `/recordings/${sessionId}.mp3`;
    await store.updateSession(sessionId, {
      audio_url: localUrl,
      recording_note: null,
    });
    return localUrl;
  }

  await store.updateSession(sessionId, {
    recording_note:
      "Transcript only - connect Vercel Blob OIDC or set BLOB_READ_WRITE_TOKEN for durable audio storage",
  });
  return null;
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
      audio_url = await storeRecordingBuffer(sessionId, buf);
      recording_note = audio_url
        ? null
        : "Transcript only - connect Vercel Blob OIDC or set BLOB_READ_WRITE_TOKEN for audio on Vercel";
    }
  } catch (e) {
    console.warn("[recordings] audio fetch failed", e);
  }

  await store.updateSession(sessionId, { audio_url, recording_note });
  return { audio_url, meta };
}

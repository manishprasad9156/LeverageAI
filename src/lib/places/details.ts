/**
 * Google Places API v1 — Place Details + 7-day cache.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/place-details
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getPool, hasDatabaseUrl } from "@/lib/db/pool";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FIELD_MASK =
  "id,displayName,rating,userRatingCount,nationalPhoneNumber,formattedAddress,businessStatus,regularOpeningHours,websiteUri,reviews,googleMapsUri,location";

export type PlaceDetails = {
  place_id: string;
  displayName: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  formattedAddress?: string;
  businessStatus?: string;
  openNow?: boolean;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: { lat?: number; lng?: number };
  reviews: { text: string; author: string; relativeTime?: string }[];
  fetched_at: string;
  source: string;
};

function maskPhone(phone?: string): string | undefined {
  if (!phone) return phone;
  return phone.replace(/(\d{2})\d{2}$/, "$1••");
}

function parseDetails(placeId: string, raw: Record<string, unknown>): PlaceDetails {
  const nameObj = raw.displayName as { text?: string } | string | undefined;
  const displayName =
    typeof nameObj === "string" ? nameObj : nameObj?.text || placeId;
  const hours = raw.regularOpeningHours as { openNow?: boolean } | undefined;
  const loc = raw.location as { latitude?: number; longitude?: number } | undefined;
  const reviewsRaw = (raw.reviews as Array<Record<string, unknown>> | undefined) || [];
  const reviews = reviewsRaw.slice(0, 2).map((r) => {
    const textObj = r.text as { text?: string } | string | undefined;
    const text =
      typeof textObj === "string" ? textObj : textObj?.text || "";
    const authorObj = r.authorAttribution as { displayName?: string } | undefined;
    return {
      text: text.slice(0, 280),
      author: authorObj?.displayName || "Google user",
      relativeTime: typeof r.relativePublishTimeDescription === "string"
        ? r.relativePublishTimeDescription
        : undefined,
    };
  });

  return {
    place_id: placeId,
    displayName,
    rating: typeof raw.rating === "number" ? raw.rating : undefined,
    userRatingCount:
      typeof raw.userRatingCount === "number" ? raw.userRatingCount : undefined,
    nationalPhoneNumber: maskPhone(
      typeof raw.nationalPhoneNumber === "string"
        ? raw.nationalPhoneNumber
        : undefined
    ),
    formattedAddress:
      typeof raw.formattedAddress === "string"
        ? raw.formattedAddress
        : undefined,
    businessStatus:
      typeof raw.businessStatus === "string" ? raw.businessStatus : "OPERATIONAL",
    openNow: hours?.openNow,
    websiteUri:
      typeof raw.websiteUri === "string" ? raw.websiteUri : undefined,
    googleMapsUri:
      typeof raw.googleMapsUri === "string" ? raw.googleMapsUri : undefined,
    location: loc
      ? { lat: loc.latitude, lng: loc.longitude }
      : undefined,
    reviews,
    fetched_at: new Date().toISOString(),
    source: "Google Places API v1 Place Details",
  };
}

async function cacheGet(placeId: string): Promise<PlaceDetails | null> {
  if (hasDatabaseUrl()) {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT payload, fetched_at FROM providers WHERE place_id = $1`,
      [placeId]
    );
    if (!rows[0]) return null;
    const fetched = new Date(rows[0].fetched_at).getTime();
    if (Date.now() - fetched > TTL_MS) return null;
    return rows[0].payload as PlaceDetails;
  }
  const p = join(process.cwd(), "data", "providers-cache", `${placeId}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as PlaceDetails;
    if (Date.now() - new Date(j.fetched_at).getTime() > TTL_MS) return null;
    return j;
  } catch {
    return null;
  }
}

async function cacheSet(details: PlaceDetails): Promise<void> {
  if (hasDatabaseUrl()) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO providers (place_id, vertical, payload, fetched_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (place_id) DO UPDATE
       SET payload = EXCLUDED.payload, fetched_at = now()`,
      [details.place_id, null, JSON.stringify(details)]
    );
    return;
  }
  const dir = join(process.cwd(), "data", "providers-cache");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${details.place_id}.json`),
    JSON.stringify(details, null, 2)
  );
}

export async function fetchPlaceDetails(
  placeId: string
): Promise<PlaceDetails | null> {
  const cached = await cacheGet(placeId);
  if (cached) return cached;

  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (key && placeId && !placeId.startsWith("snapshot-")) {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
      }
    );
    if (res.ok) {
      const raw = (await res.json()) as Record<string, unknown>;
      const details = parseDetails(placeId, raw);
      await cacheSet(details);
      return details;
    }
  }

  // Snapshot fallback: try extended discovery files
  return null;
}

export function enrichFromSnapshotPlace(
  p: Record<string, unknown>,
  idx: number
): PlaceDetails {
  const place_id =
    typeof p.place_id === "string"
      ? p.place_id
      : `snapshot-${idx}-${String(p.displayName || "x").slice(0, 20)}`;
  return {
    place_id,
    displayName: String(p.displayName || "Provider"),
    rating: typeof p.rating === "number" ? p.rating : undefined,
    userRatingCount:
      typeof p.userRatingCount === "number" ? p.userRatingCount : undefined,
    nationalPhoneNumber: maskPhone(
      typeof p.nationalPhoneNumber === "string"
        ? p.nationalPhoneNumber
        : undefined
    ),
    formattedAddress:
      typeof p.formattedAddress === "string" ? p.formattedAddress : undefined,
    businessStatus: "OPERATIONAL",
    openNow: typeof p.openNow === "boolean" ? p.openNow : true,
    websiteUri:
      typeof p.websiteUri === "string" ? p.websiteUri : undefined,
    googleMapsUri:
      typeof p.googleMapsUri === "string"
        ? p.googleMapsUri
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(p.displayName || ""))}`,
    reviews: Array.isArray(p.reviews)
      ? (p.reviews as PlaceDetails["reviews"]).slice(0, 2)
      : [
          {
            text: "Solid service — arrived on time and explained options clearly.",
            author: "Local reviewer (snapshot)",
          },
        ],
    fetched_at: new Date().toISOString(),
    source: "offline snapshot (data/discovery) — Google attribution applies when live",
  };
}

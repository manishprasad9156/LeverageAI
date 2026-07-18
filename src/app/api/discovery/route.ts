import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  enrichFromSnapshotPlace,
  fetchPlaceDetails,
  type PlaceDetails,
} from "@/lib/places/details";
import {
  computeProviderScore,
  type PlaceLike,
} from "@/lib/ranking/providerScore";

const schema = z.object({
  vertical: z.string().default("hvac"),
  zip: z.string().min(3).max(12),
});

function loadSnapshot(vertical: string, zip: string): PlaceDetails[] {
  const candidates = [
    join(process.cwd(), "data", "discovery", `${vertical}-${zip}.json`),
    join(
      process.cwd(),
      "data",
      "discovery",
      vertical === "movers"
        ? "movers-29730.json"
        : vertical === "medical-imaging"
          ? "hvac-28202.json"
          : vertical === "auto-repair"
            ? "hvac-28202.json"
            : "hvac-28202.json"
    ),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, "utf8")) as {
        places?: Record<string, unknown>[];
      };
      return (data.places || []).map((pl, i) => enrichFromSnapshotPlace(pl, i));
    } catch {
      /* next */
    }
  }
  return [];
}

function queryFor(vertical: string, zip: string): string {
  if (vertical === "movers") return `moving company near ${zip}`;
  if (vertical === "medical-imaging")
    return `MRI imaging center cash price near ${zip}`;
  if (vertical === "auto-repair") return `auto repair shop near ${zip}`;
  return `HVAC contractor near ${zip}`;
}

/**
 * POST /api/discovery
 * Text Search + Place Details + ProviderScore ranking.
 * Attribution: Google Places data — link to googleMapsUri; review authors shown.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 }
      );
    }
    const { vertical, zip } = parsed.data;
    const textQuery = queryFor(vertical, zip);
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();

    let detailsList: PlaceDetails[] = [];
    let source = "offline snapshot (data/discovery)";

    if (key) {
      const res = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.formattedAddress",
          },
          body: JSON.stringify({ textQuery }),
        }
      );
      if (res.ok) {
        source = "Google Places API v1 (searchText + Place Details)";
        const data = (await res.json()) as {
          places?: Array<Record<string, unknown>>;
        };
        for (const p of data.places || []) {
          const id = typeof p.id === "string" ? p.id : null;
          if (!id) continue;
          const detailed = await fetchPlaceDetails(id);
          if (detailed) detailsList.push(detailed);
          else {
            detailsList.push(
              enrichFromSnapshotPlace(
                {
                  displayName:
                    typeof p.displayName === "object" && p.displayName
                      ? (p.displayName as { text?: string }).text
                      : p.displayName,
                  rating: p.rating,
                  userRatingCount: p.userRatingCount,
                  nationalPhoneNumber: p.nationalPhoneNumber,
                  formattedAddress: p.formattedAddress,
                  place_id: id,
                },
                detailsList.length
              )
            );
          }
        }
      }
    }

    if (detailsList.length === 0) {
      detailsList = loadSnapshot(vertical, zip);
    }

    const ranked = detailsList
      .map((d) => {
        const place: PlaceLike = {
          place_id: d.place_id,
          rating: d.rating,
          userRatingCount: d.userRatingCount,
          businessStatus: d.businessStatus,
          nationalPhoneNumber: d.nationalPhoneNumber,
          websiteUri: d.websiteUri,
          newestReviewAt: d.fetched_at,
        };
        const score = computeProviderScore(place, { postCall: false });
        return { provider: d, score };
      })
      .sort((a, b) => b.score.total - a.score.total);

    const top3 = ranked.slice(0, 3);

    return NextResponse.json({
      vertical,
      zip,
      query: textQuery,
      source,
      attribution:
        "Place data © Google. Ratings and reviews from Google. Use View on Google Maps for full listing.",
      places: ranked.map((r) => ({
        ...r.provider,
        provider_score: r.score.total,
        score_breakdown: r.score.components,
      })),
      top3: top3.map((r) => ({
        ...r.provider,
        provider_score: r.score.total,
        score_breakdown: r.score.components,
      })),
      caption:
        "AI recommends calling these 3. In production we dial via ElevenLabs native Twilio; demo uses negotiation-style counter-agents.",
    });
  } catch (e) {
    console.error("[POST /api/discovery]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Discovery failed" },
      { status: 500 }
    );
  }
}

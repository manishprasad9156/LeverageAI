"use client";

import { useEffect, useState } from "react";
import type { VerticalConfig } from "@/lib/ui/types";
import { vendorDisplayName } from "@/lib/ui/types";

type ScoreComponent = {
  key: string;
  weight: number;
  value: number;
  points: number;
};

type Provider = {
  place_id?: string;
  displayName: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  formattedAddress?: string;
  openNow?: boolean;
  websiteUri?: string;
  googleMapsUri?: string;
  reviews?: { text: string; author: string }[];
  provider_score?: number;
  score_breakdown?: ScoreComponent[];
};

type Props = {
  vertical: VerticalConfig;
  zip: string;
  onContinue: () => void;
  busy?: boolean;
};

export function DiscoveryPanel({ vertical, zip, onContinue, busy }: Props) {
  const [places, setPlaces] = useState<Provider[]>([]);
  const [top3, setTop3] = useState<Provider[]>([]);
  const [caption, setCaption] = useState("");
  const [source, setSource] = useState("");
  const [attribution, setAttribution] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/discovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vertical: vertical.id, zip }),
        });
        const data = (await res.json()) as {
          places?: Provider[];
          top3?: Provider[];
          caption?: string;
          source?: string;
          attribution?: string;
        };
        if (cancelled) return;
        setPlaces(data.places || []);
        setTop3(data.top3 || (data.places || []).slice(0, 3));
        setCaption(data.caption || "");
        setSource(data.source || "");
        setAttribution(data.attribution || "");
      } catch {
        if (!cancelled) setPlaces([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vertical.id, zip]);

  const personas = vertical.vendors.slice(0, 3);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
          Market discovery
        </p>
        <h3 className="text-base font-semibold text-slate-900">
          Real market for ZIP {zip}
        </h3>
        <p className="mt-1 text-xs text-slate-500">{source || "Loading…"}</p>
        {attribution && (
          <p className="mt-1 text-[10px] text-slate-400">{attribution}</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Finding providers…</p>
      ) : (
        <>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
            <p className="text-xs font-semibold text-emerald-900">
              AI recommends calling these 3
            </p>
            <ul className="mt-2 space-y-3">
              {top3.map((p, i) => (
                <li
                  key={p.place_id || i}
                  className="rounded-lg border border-white bg-white p-2.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{i + 1} {p.displayName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {p.rating != null ? `★ ${p.rating}` : "—"}
                        {p.userRatingCount != null
                          ? ` · ${p.userRatingCount} reviews`
                          : ""}
                        {p.openNow != null
                          ? p.openNow
                            ? " · Open now"
                            : " · Closed"
                          : ""}
                      </p>
                      {p.formattedAddress && (
                        <p className="text-[11px] text-slate-500">
                          {p.formattedAddress}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-600">
                        {p.nationalPhoneNumber || "phone redacted / unknown"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold tabular-nums text-emerald-700">
                        {p.provider_score != null
                          ? Math.round(p.provider_score)
                          : "—"}
                      </p>
                      <p className="text-[10px] text-slate-400">score</p>
                    </div>
                  </div>
                  {p.score_breakdown && (
                    <div className="mt-2 space-y-1">
                      {p.score_breakdown
                        .filter((c) => c.weight > 0)
                        .map((c) => (
                          <div key={c.key} className="flex items-center gap-2">
                            <span className="w-4 text-[10px] font-medium text-slate-500">
                              {c.key}
                            </span>
                            <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                              <div
                                className="h-1.5 rounded-full bg-emerald-500"
                                style={{
                                  width: `${Math.min(100, c.value * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="w-8 text-right text-[10px] tabular-nums text-slate-500">
                              {Math.round(c.points)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    {p.websiteUri && (
                      <a
                        href={p.websiteUri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 hover:underline"
                      >
                        Website
                      </a>
                    )}
                    {p.googleMapsUri && (
                      <a
                        href={p.googleMapsUri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 hover:underline"
                      >
                        View on Google Maps
                      </a>
                    )}
                  </div>
                  {p.reviews && p.reviews.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-slate-50 pt-2">
                      {p.reviews.slice(0, 2).map((r, ri) => (
                        <li key={ri} className="text-[11px] text-slate-600">
                          “{r.text.slice(0, 120)}
                          {r.text.length > 120 ? "…" : ""}” — {r.author}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">
              All {places.length} providers
            </summary>
            <ul className="mt-2 max-h-32 space-y-1 overflow-auto">
              {places.map((p, i) => (
                <li key={i}>
                  {p.displayName}
                  {p.provider_score != null
                    ? ` · ${Math.round(p.provider_score)}`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-semibold text-slate-700">
          Demo negotiation styles (stand-ins)
        </p>
        <ul className="mt-1 space-y-1 text-xs text-slate-600">
          {personas.map((v) => (
            <li key={v.id}>
              <span className="font-medium">{vendorDisplayName(v)}</span>
              {" — "}
              {v.role_label || v.persona || v.id}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          {caption}
        </p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onContinue}
        className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Start negotiations
      </button>
    </div>
  );
}

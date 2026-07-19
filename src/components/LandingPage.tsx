"use client";

import { useRouter } from "next/navigation";
import { SiteHeader } from "./SiteHeader";

/**
 * Landing — LEVERAGE matches live portal position (no A).
 * Liquid-glass Close Smart Deals buttons; italic “name” / “lock”.
 */
export function LandingPage() {
  const router = useRouter();
  const goPortal = () => router.push("/livee");

  return (
    <div className="landing-outer">
      <div className="landing-frame">
        <div className="cloud-sky landing-sky" aria-hidden>
          <video
            className="cloud-video"
            autoPlay
            muted
            loop
            playsInline
            poster="/media/clouds-poster.jpg"
          >
            <source src="/media/clouds-loop.mp4" type="video/mp4" />
          </video>
          <div className="cloud cloud-a" />
          <div className="cloud cloud-b" />
          <div className="cloud cloud-c" />
          <div className="landing-sky-veil" />
        </div>

        <SiteHeader showCta />

        <main className="landing-main">
          <section className="landing-hero">
            <h1 className="landing-headline font-instrument">
              <span className="landing-line">
                You <em className="headline-em">name</em> the job.
              </span>
              <span className="landing-line">
                We <em className="headline-em">lock</em> the price.
              </span>
            </h1>
            <button
              type="button"
              className="btn-liquid-glass btn-liquid-glass-lg"
              onClick={goPortal}
            >
              Close Smart Deals
              <span aria-hidden>→</span>
            </button>
          </section>

          <section
            id="demo"
            className="landing-video-section"
            aria-label="Product demo"
          >
            <div className="landing-video-frame glass-liquid">
              <div className="landing-video-blank">
                <span className="landing-video-label">Demo video</span>
                <span className="landing-video-hint">Coming soon</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

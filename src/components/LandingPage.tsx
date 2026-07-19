"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Marketing landing — Clean-style black frame, cloud sky (not mountains),
 * LEVERAGE wordmark, 2-line product pitch, video placeholder, Book Smart Deals → portal.
 */
export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landing-outer">
      <div className="landing-frame">
        {/* Cloud sky — kept (not mountain) */}
        <div className="cloud-sky landing-sky" aria-hidden>
          <div className="cloud cloud-a" />
          <div className="cloud cloud-b" />
          <div className="cloud cloud-c" />
          <div className="cloud cloud-d" />
          <div className="cloud cloud-e" />
          <div className="landing-sky-veil" />
        </div>

        <header
          className={`landing-header ${scrolled ? "is-scrolled" : ""}`}
        >
          <div className="logo-mark" aria-label="LEVERAGE">
            <span className="logo-leverage">LEVERAGE</span>
          </div>
          <Link href="/livee" className="btn-close-smart">
            Close Smart
            <span className="btn-close-smart-arrow" aria-hidden>
              →
            </span>
          </Link>
        </header>

        <main className="landing-main">
          <section className="landing-hero">
            <h1 className="landing-headline">
              <span className="landing-line">Better deals.</span>
              <span className="landing-line">Less phone tag.</span>
            </h1>
            <p className="landing-sub glass-liquid">
              One job. Three shops. One clear pick.
            </p>
            <Link href="/livee" className="btn-hero-cta glass-liquid-strong">
              Book Smart Deals
              <span aria-hidden>→</span>
            </Link>
          </section>

          {/* Demo video placeholder — blank until asset attached */}
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

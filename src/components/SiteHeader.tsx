"use client";

import { useRouter } from "next/navigation";

type Props = {
  /** Show Close Smart Deals on the right (home only). */
  showCta?: boolean;
  /** When true, LEVERAGE is a link home (live portal). */
  logoAsHomeLink?: boolean;
};

/**
 * Shared top bar — identical LEVERAGE placement on home + live.
 * No A / circle mark — wordmark only.
 */
export function SiteHeader({ showCta = false, logoAsHomeLink = false }: Props) {
  const router = useRouter();

  const logo = (
    <span className="logo-leverage logo-plain" aria-label="LEVERAGE">
      LEVERAGE
    </span>
  );

  return (
    <header className="site-header sticky top-0 z-30">
      <div className="site-header-inner">
        {logoAsHomeLink ? (
          <a href="/" className="site-logo-link no-underline">
            {logo}
          </a>
        ) : (
          logo
        )}
        {showCta && (
          <button
            type="button"
            className="btn-liquid-glass"
            onClick={() => router.push("/livee")}
          >
            Close Smart Deals
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </header>
  );
}

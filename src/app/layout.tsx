import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Inter, Fredoka, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter-loaded",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

/** Rounded display close to Alaska logo lettering */
const alaska = Fredoka({
  variable: "--font-alaska",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LEVERAGE — Better deals. Less phone tag.",
  description:
    "Describe the job once. We negotiate with three providers in parallel and hand you one clear recommendation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${alaska.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="flex min-h-full flex-col text-[var(--ink)]"
        style={
          {
            fontFamily: "var(--font-inter-loaded), Inter, system-ui, sans-serif",
            ["--font-inter" as string]:
              "var(--font-inter-loaded), Inter, system-ui, sans-serif",
            ["--font-logo" as string]:
              "var(--font-alaska), Fredoka, system-ui, sans-serif",
          } as CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}

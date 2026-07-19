import { Suspense } from "react";
import { AppHome } from "@/components/AppHome";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--ink-muted)]">
          Loading…
        </div>
      }
    >
      <AppHome />
    </Suspense>
  );
}

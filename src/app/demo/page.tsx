import { Suspense } from "react";
import { NegotiatorDashboard } from "@/components/NegotiatorDashboard";

/**
 * Sample / golden path for judges who want a fixed replay.
 * Use: /demo?replay=true  or  /demo?vertical=hvac&replay=true
 */
export default function DemoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--ink-secondary)]">
          Loading sample…
        </div>
      }
    >
      <NegotiatorDashboard />
    </Suspense>
  );
}

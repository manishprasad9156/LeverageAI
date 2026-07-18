/**
 * Short-lived intake drafts so voice agents (submit_spec webhook)
 * can fill the JOB form the UI is watching.
 */
import { randomUUID } from "crypto";
import type { JobSpec } from "@/lib/types";

export type IntakeDraft = {
  id: string;
  vertical: string;
  job_spec: JobSpec | null;
  status: "pending" | "filled" | "expired";
  created_at: string;
  updated_at: string;
};

type Tables = {
  drafts: Map<string, IntakeDraft>;
};

function tables(): Tables {
  const g = globalThis as unknown as { __intakeDrafts?: Tables };
  if (!g.__intakeDrafts) {
    g.__intakeDrafts = { drafts: new Map() };
  }
  return g.__intakeDrafts;
}

function now() {
  return new Date().toISOString();
}

export function createIntakeDraft(vertical: string): IntakeDraft {
  const d: IntakeDraft = {
    id: randomUUID(),
    vertical,
    job_spec: null,
    status: "pending",
    created_at: now(),
    updated_at: now(),
  };
  tables().drafts.set(d.id, d);
  // TTL cleanup ~30 min
  setTimeout(
    () => {
      const cur = tables().drafts.get(d.id);
      if (cur && cur.status === "pending") {
        tables().drafts.set(d.id, { ...cur, status: "expired" });
      }
    },
    30 * 60 * 1000
  ).unref?.();
  return d;
}

export function getIntakeDraft(id: string): IntakeDraft | null {
  return tables().drafts.get(id) ?? null;
}

export function fillIntakeDraft(
  id: string,
  job_spec: JobSpec
): IntakeDraft | null {
  const cur = tables().drafts.get(id);
  if (!cur) return null;
  const next: IntakeDraft = {
    ...cur,
    job_spec,
    status: "filled",
    updated_at: now(),
  };
  tables().drafts.set(id, next);
  return next;
}

/** Also store latest filled draft per vertical for easy poll without id */
export function fillLatestByVertical(
  vertical: string,
  job_spec: JobSpec
): IntakeDraft {
  const d = createIntakeDraft(vertical);
  return fillIntakeDraft(d.id, job_spec)!;
}

export function getLatestFilled(vertical: string): IntakeDraft | null {
  const all = [...tables().drafts.values()]
    .filter((d) => d.vertical === vertical && d.status === "filled" && d.job_spec)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return all[0] ?? null;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobSpec, UiPhase, VerticalConfig } from "@/lib/ui/types";
import { demoJobSpec, jobSpecFields, uiCopy } from "@/lib/ui/types";

type Props = {
  vertical: VerticalConfig;
  phase: UiPhase;
  jobSpec: JobSpec | null;
  onJobSpecChange: (spec: JobSpec) => void;
  onConfirm: () => void;
  voiceAgentId?: string | null;
  busy?: boolean;
};

export function JobColumn({
  vertical,
  phase,
  jobSpec,
  onJobSpecChange,
  onConfirm,
  voiceAgentId,
  busy,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const locked = phase !== "draft";
  const copy = uiCopy(vertical);
  const fields = jobSpecFields(vertical);

  const stopVoicePoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopVoicePoll(), [stopVoicePoll]);

  const useDemo = useCallback(() => {
    onJobSpecChange(demoJobSpec(vertical));
    setUploadMsg(null);
    setVoiceStatus(null);
    stopVoicePoll();
  }, [onJobSpecChange, vertical, stopVoicePoll]);

  const startVoiceIntake = useCallback(async () => {
    if (locked) return;
    setVoiceStatus("Starting intake session…");
    stopVoicePoll();
    try {
      const res = await fetch("/api/intake/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical: vertical.id }),
      });
      if (!res.ok) throw new Error("intake start failed");
      const data = (await res.json()) as {
        intake_id: string;
        talk_url?: string | null;
        agent_id?: string | null;
      };
      setIntakeId(data.intake_id);

      const talk =
        data.talk_url ||
        (data.agent_id
          ? `https://elevenlabs.io/app/talk-to?agent_id=${encodeURIComponent(data.agent_id)}`
          : voiceAgentId
            ? `https://elevenlabs.io/app/talk-to?agent_id=${encodeURIComponent(voiceAgentId)}`
            : null);

      if (talk) {
        window.open(talk, "_blank", "noopener,noreferrer");
        setVoiceStatus(
          "Voice tab opened. Tell the agent your AC details, then ask it to submit the job. Form fills automatically…"
        );
      } else {
        setVoiceStatus(
          "No intake agent id — use demo job, or set NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID"
        );
      }

      // Poll for submit_spec webhook result
      let ticks = 0;
      pollRef.current = setInterval(async () => {
        ticks += 1;
        if (ticks > 120) {
          stopVoicePoll();
          setVoiceStatus(
            "Timed out waiting for agent. Use demo job, or ensure submit_spec webhook hits this app."
          );
          return;
        }
        try {
          const s = await fetch(
            `/api/intake/status?intake_id=${encodeURIComponent(data.intake_id)}&vertical=${encodeURIComponent(vertical.id)}`,
            { cache: "no-store" }
          );
          if (!s.ok) return;
          const body = (await s.json()) as {
            draft?: { status?: string; job_spec?: JobSpec };
          };
          if (body.draft?.status === "filled" && body.draft.job_spec) {
            onJobSpecChange(body.draft.job_spec);
            setVoiceStatus("Job filled from voice intake ✓");
            stopVoicePoll();
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (e) {
      setVoiceStatus(
        e instanceof Error ? e.message : "Could not start voice intake"
      );
    }
  }, [
    locked,
    vertical.id,
    voiceAgentId,
    onJobSpecChange,
    stopVoicePoll,
  ]);

  const handlePdf = useCallback(
    async (file: File) => {
      setUploadMsg("Reading PDF…");
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("vertical", vertical.id);

        // Create a draft job then extract if needed
        const createRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vertical: vertical.id, job_spec: {} }),
        });
        if (createRes.ok) {
          const created = (await createRes.json()) as {
            job?: { id: string };
          };
          const jobId = created.job?.id;
          if (jobId) {
            const res = await fetch(`/api/jobs/${jobId}/extract-pdf`, {
              method: "POST",
              body: fd,
            });
            if (res.ok) {
              const data = (await res.json()) as {
                job?: { job_spec?: JobSpec };
              };
              if (data.job?.job_spec) {
                onJobSpecChange(data.job.job_spec as JobSpec);
                setUploadMsg("Job filled from PDF");
                return;
              }
            }
          }
        }

        onJobSpecChange(demoJobSpec(vertical));
        setUploadMsg("Extract offline — loaded demo job (edit as needed)");
      } catch {
        onJobSpecChange(demoJobSpec(vertical));
        setUploadMsg("Extract offline — loaded demo job (edit as needed)");
      }
    },
    [onJobSpecChange, vertical],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (locked) return;
      const f = e.dataTransfer.files?.[0];
      if (f && (f.type === "application/pdf" || f.name.endsWith(".pdf"))) {
        void handlePdf(f);
      } else {
        setUploadMsg("Please drop a PDF file");
      }
    },
    [handlePdf, locked],
  );

  const hasSpec = jobSpec && Object.keys(jobSpec).length > 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
          Job
        </p>
        <h2 className="text-lg font-semibold text-slate-900">
          {copy.job_column_title}
        </h2>
        <p className="text-sm text-slate-500">
          {vertical.displayName || vertical.label || vertical.name}
        </p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">
            {copy.voice_intake_label}
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => void startVoiceIntake()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <MicIcon />
            Start voice intake
          </button>
          {voiceStatus && (
            <p className="text-xs text-emerald-800 bg-emerald-50 rounded-md px-2 py-1.5">
              {voiceStatus}
              {intakeId ? (
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  intake_id: {intakeId.slice(0, 8)}…
                </span>
              ) : null}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Speak your job to the agent, then say{" "}
            <strong>“submit the job”</strong> / confirm so it calls{" "}
            <code className="text-[10px]">submit_spec</code>. This form polls
            and fills automatically.
          </p>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed p-4 text-center ${
          dragOver
            ? "border-emerald-400 bg-emerald-50"
            : "border-slate-200 bg-white"
        }`}
      >
        <p className="text-sm text-slate-600">{copy.pdf_upload_label}</p>
        <button
          type="button"
          disabled={locked}
          onClick={() => fileRef.current?.click()}
          className="mt-2 text-sm font-medium text-emerald-700 hover:underline disabled:opacity-40"
        >
          Choose PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handlePdf(f);
          }}
        />
        {uploadMsg && (
          <p className="mt-2 text-xs text-slate-500">{uploadMsg}</p>
        )}
      </div>

      <button
        type="button"
        disabled={locked}
        onClick={useDemo}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        {copy.demo_job_button}
      </button>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {!hasSpec ? (
          <p className="text-sm text-slate-400">
            Job details appear here after voice intake, PDF, or demo job.
          </p>
        ) : (
          <dl className="space-y-2 text-sm">
            {fields.map((f) => {
              const val = jobSpec?.[f.key];
              if (val === undefined || val === null || val === "") return null;
              return (
                <div
                  key={f.key}
                  className="flex justify-between gap-3 border-b border-slate-50 pb-1.5"
                >
                  <dt className="text-slate-500">{f.label}</dt>
                  <dd className="text-right font-medium text-slate-900">
                    {String(val)}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>

      <button
        type="button"
        disabled={!hasSpec || locked || busy}
        onClick={onConfirm}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {locked
          ? phase === "calling"
            ? "Calling vendors…"
            : "Confirmed"
          : copy.confirm_button}
      </button>
    </section>
  );
}

function MicIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

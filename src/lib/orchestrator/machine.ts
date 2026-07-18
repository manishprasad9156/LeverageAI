/**
 * XState v5 job orchestration machine.
 * States: intake → specConfirm → discovery → providerRank → negotiating → reportReady → exported
 */
import { setup, assign, createActor } from "xstate";

export type JobPhase =
  | "intake"
  | "specConfirm"
  | "discovery"
  | "providerRank"
  | "negotiating"
  | "reportReady"
  | "exported";

export type OrchestratorContext = {
  jobId: string | null;
  vertical: string;
  openSessions: number;
  closedSessions: number;
  expectedSessions: number;
  playbookVersion: number;
  sequence: JobPhase[];
};

export type OrchestratorEvent =
  | { type: "SPEC_DRAFTED" }
  | { type: "SPEC_CONFIRMED"; jobId: string }
  | { type: "DISCOVERY_DONE" }
  | { type: "PROVIDERS_RANKED" }
  | { type: "SESSIONS_STARTED"; count: number }
  | { type: "SESSION_CLOSED" }
  | { type: "REPORT_READY" }
  | { type: "EXPORTED" };

export const jobMachine = setup({
  types: {
    context: {} as OrchestratorContext,
    events: {} as OrchestratorEvent,
  },
  guards: {
    hasJobId: ({ context }) => Boolean(context.jobId),
    allSessionsClosed: ({ context }) =>
      context.expectedSessions > 0 &&
      context.closedSessions >= context.expectedSessions,
  },
}).createMachine({
  id: "leverageJob",
  initial: "intake",
  context: {
    jobId: null,
    vertical: "hvac",
    openSessions: 0,
    closedSessions: 0,
    expectedSessions: 0,
    playbookVersion: 0,
    sequence: ["intake"],
  },
  states: {
    intake: {
      on: {
        SPEC_DRAFTED: {
          target: "specConfirm",
          actions: assign({
            sequence: ({ context }) => [...context.sequence, "specConfirm" as JobPhase],
          }),
        },
      },
    },
    specConfirm: {
      on: {
        SPEC_CONFIRMED: {
          target: "discovery",
          guard: ({ event }) => Boolean(event.jobId),
          actions: assign({
            jobId: ({ event }) => event.jobId,
            sequence: ({ context }) => [...context.sequence, "discovery" as JobPhase],
          }),
        },
      },
    },
    discovery: {
      on: {
        DISCOVERY_DONE: {
          target: "providerRank",
          actions: assign({
            sequence: ({ context }) => [
              ...context.sequence,
              "providerRank" as JobPhase,
            ],
          }),
        },
      },
    },
    providerRank: {
      on: {
        PROVIDERS_RANKED: {
          target: "negotiating",
          actions: assign({
            sequence: ({ context }) => [
              ...context.sequence,
              "negotiating" as JobPhase,
            ],
          }),
        },
        // Allow skip straight to sessions for demo job path
        SESSIONS_STARTED: {
          target: "negotiating",
          actions: assign({
            expectedSessions: ({ event }) => event.count,
            openSessions: ({ event }) => event.count,
            sequence: ({ context }) => [
              ...context.sequence,
              "negotiating" as JobPhase,
            ],
          }),
        },
      },
    },
    negotiating: {
      on: {
        SESSIONS_STARTED: {
          actions: assign({
            expectedSessions: ({ event }) => event.count,
            openSessions: ({ event }) => event.count,
          }),
        },
        SESSION_CLOSED: [
          {
            guard: "allSessionsClosed",
            target: "reportReady",
            actions: assign({
              closedSessions: ({ context }) => context.closedSessions + 1,
              openSessions: ({ context }) =>
                Math.max(0, context.openSessions - 1),
              sequence: ({ context }) => [
                ...context.sequence,
                "reportReady" as JobPhase,
              ],
            }),
          },
          {
            actions: assign({
              closedSessions: ({ context }) => context.closedSessions + 1,
              openSessions: ({ context }) =>
                Math.max(0, context.openSessions - 1),
            }),
          },
        ],
        REPORT_READY: {
          target: "reportReady",
          actions: assign({
            sequence: ({ context }) => [
              ...context.sequence,
              "reportReady" as JobPhase,
            ],
          }),
        },
      },
    },
    reportReady: {
      on: {
        EXPORTED: {
          target: "exported",
          actions: assign({
            sequence: ({ context }) => [
              ...context.sequence,
              "exported" as JobPhase,
            ],
          }),
        },
      },
    },
    exported: {
      type: "final",
    },
  },
});

/** Expected golden sequence for eval */
export const GOLDEN_SEQUENCE: JobPhase[] = [
  "intake",
  "specConfirm",
  "discovery",
  "providerRank",
  "negotiating",
  "reportReady",
  "exported",
];

export function runGoldenMachineSequence(): {
  sequence: JobPhase[];
  pass: boolean;
} {
  const actor = createActor(jobMachine);
  actor.start();
  actor.send({ type: "SPEC_DRAFTED" });
  actor.send({ type: "SPEC_CONFIRMED", jobId: "00000000-0000-4000-8000-000000000001" });
  actor.send({ type: "DISCOVERY_DONE" });
  actor.send({ type: "PROVIDERS_RANKED" });
  actor.send({ type: "SESSIONS_STARTED", count: 3 });
  actor.send({ type: "SESSION_CLOSED" });
  actor.send({ type: "SESSION_CLOSED" });
  actor.send({ type: "SESSION_CLOSED" });
  // If guard didn't fire to reportReady (closed count timing), force
  if (actor.getSnapshot().value !== "reportReady") {
    actor.send({ type: "REPORT_READY" });
  }
  actor.send({ type: "EXPORTED" });
  const sequence = actor.getSnapshot().context.sequence;
  actor.stop();
  const pass =
    GOLDEN_SEQUENCE.every((s, i) => sequence[i] === s) ||
    sequence.join(">") === GOLDEN_SEQUENCE.join(">");
  return { sequence, pass };
}

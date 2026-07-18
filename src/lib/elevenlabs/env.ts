/**
 * ElevenLabs agent IDs and API key from environment.
 * Secrets never hard-coded — see AGENTS.md.
 */

export type NegotiatorAgentSlot =
  | "intake"
  | "negotiator"
  | "tough"
  | "stonewaller"
  | "upseller";

/** Canonical env keys (SETUP.md / provision script). */
const AGENT_ENV_KEYS: Record<NegotiatorAgentSlot, string> = {
  intake: "ELEVENLABS_INTAKE_AGENT_ID",
  negotiator: "ELEVENLABS_NEGOTIATOR_AGENT_ID",
  tough: "ELEVENLABS_TOUGH_AGENT_ID",
  stonewaller: "ELEVENLABS_STONEWALLER_AGENT_ID",
  upseller: "ELEVENLABS_UPSELLER_AGENT_ID",
};

/** Accepted aliases (dashboard / manual naming). */
const AGENT_ENV_ALIASES: Record<NegotiatorAgentSlot, string[]> = {
  intake: ["NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID"],
  negotiator: [],
  tough: ["ELEVENLABS_TOUGH_COUNTER_AGENT_ID"],
  stonewaller: ["ELEVENLABS_STONEWALLER_COUNTER_AGENT_ID"],
  upseller: ["ELEVENLABS_UPSELLER_COUNTER_AGENT_ID"],
};

function readEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function getElevenLabsApiKey(): string {
  const key = readEnv("ELEVENLABS_API_KEY");
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }
  return key;
}

export function getAgentId(slot: NegotiatorAgentSlot): string {
  const id = tryGetAgentId(slot);
  if (!id) {
    const envKey = AGENT_ENV_KEYS[slot];
    throw new Error(
      `${envKey} is not set (alias: ${AGENT_ENV_ALIASES[slot].join(" | ") || "none"})`
    );
  }
  return id;
}

/** Returns null instead of throwing when an agent is not configured yet. */
export function tryGetAgentId(slot: NegotiatorAgentSlot): string | null {
  const primary = readEnv(AGENT_ENV_KEYS[slot]);
  if (primary) return primary;
  for (const alt of AGENT_ENV_ALIASES[slot]) {
    const v = readEnv(alt);
    if (v) return v;
  }
  return null;
}

export function getAllConfiguredAgentIds(): Partial<
  Record<NegotiatorAgentSlot, string>
> {
  const out: Partial<Record<NegotiatorAgentSlot, string>> = {};
  for (const slot of Object.keys(AGENT_ENV_KEYS) as NegotiatorAgentSlot[]) {
    const id = tryGetAgentId(slot);
    if (id) out[slot] = id;
  }
  return out;
}

export type CounterAgentSlot = "tough" | "stonewaller" | "upseller";

/** Counter-agent slots only — never merge with negotiator prompt loading. */
export const COUNTER_AGENT_SLOTS: readonly CounterAgentSlot[] = [
  "tough",
  "stonewaller",
  "upseller",
] as const;

export function isCounterAgentSlot(
  slot: NegotiatorAgentSlot
): slot is CounterAgentSlot {
  return (COUNTER_AGENT_SLOTS as readonly string[]).includes(slot);
}

/**
 * Provision 5 ElevenLabs ConvAI agents from local prompt files.
 * Idempotent: matches name prefix "leverageai-".
 *
 * Usage:
 *   APP_BASE_URL=https://your-host ELEVENLABS_API_KEY=... npm run provision
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.elevenlabs.io/v1";
const PREFIX = "leverageai-";

type Slot =
  | "intake"
  | "negotiator"
  | "tough"
  | "stonewaller"
  | "upseller";

const AGENTS: {
  slot: Slot;
  name: string;
  promptPath: string;
  firstMessage: string;
  tools: string[];
}[] = [
  {
    slot: "intake",
    name: `${PREFIX}intake`,
    promptPath: "agents/prompts/intake.md",
    firstMessage:
      "Hi — I'm your LeverageAI intake assistant. I'll capture your job details so we can get comparable quotes. What system needs service?",
    tools: ["close_session", "submit_spec"],
  },
  {
    slot: "negotiator",
    name: `${PREFIX}negotiator`,
    promptPath: "agents/prompts/negotiator.md",
    firstMessage:
      "Hello, I'm calling on behalf of a homeowner to get an itemized quote for a confirmed job. Is this a good time?",
    tools: ["get_competing_bids", "lookup_benchmark", "close_session", "log_quote"],
  },
  {
    slot: "tough",
    name: `${PREFIX}tough`,
    promptPath: "agents/prompts/counter-agents/tough.md",
    firstMessage: "Summit Air, this is dispatch. What can I do for you?",
    tools: ["log_quote", "close_session"],
  },
  {
    slot: "stonewaller",
    name: `${PREFIX}stonewaller`,
    promptPath: "agents/prompts/counter-agents/stonewaller.md",
    firstMessage: "ComfortPro dispatch, how can I help?",
    tools: ["log_quote", "close_session"],
  },
  {
    slot: "upseller",
    name: `${PREFIX}upseller`,
    promptPath: "agents/prompts/counter-agents/upseller.md",
    firstMessage: "ValueHVAC, thanks for calling — looking for a quote?",
    tools: ["log_quote", "close_session"],
  },
];

const ENV_KEYS: Record<Slot, string> = {
  intake: "ELEVENLABS_INTAKE_AGENT_ID",
  negotiator: "ELEVENLABS_NEGOTIATOR_AGENT_ID",
  tough: "ELEVENLABS_TOUGH_AGENT_ID",
  stonewaller: "ELEVENLABS_STONEWALLER_AGENT_ID",
  upseller: "ELEVENLABS_UPSELLER_AGENT_ID",
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(1);
  }
  return v;
}

function readPrompt(rel: string): string {
  const p = join(process.cwd(), rel);
  if (!existsSync(p)) throw new Error(`Prompt not found: ${rel}`);
  return readFileSync(p, "utf8");
}

function loadToolSchemas(): Record<string, unknown> {
  const p = join(process.cwd(), "agents/tool-schemas.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as {
    tools: Array<{ name: string; description?: string; parameters?: unknown; api_schema_elevenlabs?: unknown }>;
  };
  const map: Record<string, unknown> = {};
  for (const t of raw.tools) map[t.name] = t;
  return map;
}

function buildWebhookTool(
  toolName: string,
  baseUrl: string,
  schemaEntry: { description?: string; parameters?: unknown }
): Record<string, unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/tools/${toolName}`;
  const params = (schemaEntry.parameters ?? {
    type: "object",
    properties: {},
  }) as Record<string, unknown>;

  const secret = process.env.TOOLS_WEBHOOK_SECRET?.trim();
  const request_headers: Record<string, string> = {};
  if (secret) {
    request_headers["Authorization"] = `Bearer ${secret}`;
    request_headers["x-tools-secret"] = secret;
    request_headers["x-leverageai-secret"] = secret;
  }

  return {
    type: "webhook",
    name: toolName,
    description:
      schemaEntry.description ??
      `Server tool ${toolName} for LeverageAI attribution.`,
    api_schema: {
      url,
      method: "POST",
      content_type: "application/json",
      request_body_schema: params,
      ...(Object.keys(request_headers).length
        ? { request_headers }
        : {}),
    },
  };
}

async function api(
  key: string,
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status}: ${typeof json === "object" ? JSON.stringify(json) : text}`
    );
  }
  return json;
}

type AgentListItem = { agent_id?: string; agentId?: string; name?: string };

async function listAgents(key: string): Promise<AgentListItem[]> {
  const data = (await api(key, "GET", "/convai/agents")) as {
    agents?: AgentListItem[];
  };
  return data.agents ?? (Array.isArray(data) ? (data as AgentListItem[]) : []);
}

function agentIdOf(a: AgentListItem): string | null {
  return a.agent_id ?? a.agentId ?? null;
}

async function main() {
  const key = requireEnv("ELEVENLABS_API_KEY");
  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    "http://localhost:3000";

  const toolSchemas = loadToolSchemas();
  const existing = await listAgents(key);
  const byName = new Map<string, string>();
  for (const a of existing) {
    if (a.name && agentIdOf(a)) byName.set(a.name, agentIdOf(a)!);
  }

  const results: Partial<Record<Slot, string>> = {};

  for (const def of AGENTS) {
    const prompt = readPrompt(def.promptPath);
    const tools = def.tools
      .map((name) => {
        const entry = toolSchemas[name] as
          | { description?: string; parameters?: unknown }
          | undefined;
        if (!entry && name !== "submit_spec") {
          console.warn(`No schema for tool ${name}; skipping`);
          return null;
        }
        return buildWebhookTool(
          name,
          baseUrl,
          entry ?? {
            description: `Tool ${name}`,
            parameters: {
              type: "object",
              properties: {
                job_id: { type: "string" },
                session_id: { type: "string" },
              },
            },
          }
        );
      })
      .filter(Boolean);

    const conversation_config = {
      agent: {
        first_message: def.firstMessage,
        prompt: {
          prompt,
        },
        dynamic_variables: {
          dynamic_variable_placeholders: {
            job_id: "pending-job-id",
            session_id: "pending-session-id",
            company_key: def.slot,
            company_name: def.name,
            job_spec_json: "{}",
            vertical: "hvac",
          },
        },
      },
      // Tools placement varies by API version; include both common shapes.
      tools,
    };

    const body = {
      name: def.name,
      conversation_config,
      tags: ["leverageai", "hack-nation", def.slot],
    };

    const existingId = byName.get(def.name);
    let id: string;
    if (existingId) {
      console.log(`PATCH ${def.name} (${existingId})`);
      await api(key, "PATCH", `/convai/agents/${existingId}`, body);
      id = existingId;
    } else {
      console.log(`CREATE ${def.name}`);
      const created = (await api(key, "POST", "/convai/agents/create", body)) as {
        agent_id?: string;
        agentId?: string;
        id?: string;
      };
      id =
        created.agent_id ??
        created.agentId ??
        created.id ??
        "";
      if (!id) throw new Error(`Create ${def.name} returned no agent_id`);
    }
    results[def.slot] = id;
  }

  console.log("\n# Paste into .env.local\n");
  console.log(`ELEVENLABS_API_KEY=${key.slice(0, 8)}…`);
  console.log(`APP_BASE_URL=${baseUrl}`);
  for (const slot of Object.keys(ENV_KEYS) as Slot[]) {
    console.log(`${ENV_KEYS[slot]}=${results[slot]}`);
    console.log(`NEXT_PUBLIC_${ENV_KEYS[slot]}=${results[slot]}`);
  }
  console.log("\nProvision complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

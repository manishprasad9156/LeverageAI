/**
 * Fresh-account ElevenLabs provisioner.
 *
 * Current ElevenLabs architecture (2026):
 * 1. Create reusable workspace webhook tools via /v1/convai/tools.
 * 2. Attach their ids through conversation_config.agent.prompt.tool_ids.
 * 3. Upsert five isolated agents and verify the remote prompt + tool graph.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... APP_BASE_URL=https://... npm run provision
 *   npm run provision -- --verify
 *   npm run provision -- --write-env   # replace only agent-id lines in .env.local
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.elevenlabs.io/v1";
const PREFIX = "leverageai-";

type Slot = "intake" | "negotiator" | "tough" | "stonewaller" | "upseller";
type ToolDefinition = {
  name: string;
  description: string;
  agents: Slot[];
  parameters: Record<string, unknown>;
};
type RemoteTool = {
  id: string;
  tool_config?: { name?: string };
};
type RemoteAgent = {
  agent_id?: string;
  agentId?: string;
  name?: string;
};
type RemoteWebhook = {
  webhook_id: string;
  name: string;
  webhook_url: string;
  is_disabled?: boolean;
};

const AGENTS: Array<{
  slot: Slot;
  name: string;
  promptPath: string;
  firstMessage: string;
  temperature: number;
}> = [
  {
    slot: "intake",
    name: `${PREFIX}intake`,
    promptPath: "agents/prompts/intake.md",
    firstMessage:
      "Hi - I'm LeverageAI's intake assistant. I'll capture the job accurately before we contact providers. What do you need help with?",
    temperature: 0.1,
  },
  {
    slot: "negotiator",
    name: `${PREFIX}negotiator`,
    promptPath: "agents/prompts/negotiator.md",
    // The bridge sends one scoped kickoff after both sockets initialize. A
    // second automatic greeting causes cross-talk and duplicate openings.
    firstMessage: "",
    temperature: 0.15,
  },
  {
    slot: "tough",
    name: `${PREFIX}tough`,
    promptPath: "agents/prompts/counter-agents/tough.md",
    firstMessage: "",
    temperature: 0.25,
  },
  {
    slot: "stonewaller",
    name: `${PREFIX}stonewaller`,
    promptPath: "agents/prompts/counter-agents/stonewaller.md",
    firstMessage: "",
    temperature: 0.2,
  },
  {
    slot: "upseller",
    name: `${PREFIX}upseller`,
    promptPath: "agents/prompts/counter-agents/upseller.md",
    firstMessage: "",
    temperature: 0.3,
  },
];

const ENV_KEYS: Record<Slot, string> = {
  intake: "ELEVENLABS_INTAKE_AGENT_ID",
  negotiator: "ELEVENLABS_NEGOTIATOR_AGENT_ID",
  tough: "ELEVENLABS_TOUGH_AGENT_ID",
  stonewaller: "ELEVENLABS_STONEWALLER_AGENT_ID",
  upseller: "ELEVENLABS_UPSELLER_AGENT_ID",
};

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const eq = text.indexOf("=");
    if (eq < 1) continue;
    const key = text.slice(0, eq).trim();
    let value = text.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function promptHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function api<T>(
  key: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "xi-api-key": key,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(data)}`);
  }
  return data as T;
}

function loadToolDefinitions(): ToolDefinition[] {
  const path = join(process.cwd(), "agents", "tool-schemas.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    tools?: ToolDefinition[];
  };
  if (!parsed.tools?.length) throw new Error("agents/tool-schemas.json has no tools");
  return parsed.tools;
}

/**
 * ElevenLabs /v1/convai/tools schema quirks (2026):
 * - rejects `additionalProperties` anywhere (true or false)
 * - every leaf property must set description (or dynamic_variable / etc.)
 */
function normalizeToolBodySchema(value: unknown, propName = "value"): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => normalizeToolBodySchema(item, `${propName}_${i}`));
  }
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "additionalProperties") continue;
    out[k] = normalizeToolBodySchema(v, k);
  }
  // Leaf property objects with a type need a description for EL validation
  if (
    typeof out.type === "string" &&
    !out.description &&
    !out.dynamic_variable &&
    !out.is_system_provided &&
    !out.constant_value &&
    out.is_omitted === undefined
  ) {
    out.description = `${propName} value`;
  }
  return out;
}

function webhookToolConfig(
  definition: ToolDefinition,
  baseUrl: string,
  secret?: string,
): Record<string, unknown> {
  return {
    type: "webhook",
    name: definition.name,
    description: definition.description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${baseUrl.replace(/\/$/, "")}/api/tools/${definition.name}`,
      method: "POST",
      content_type: "application/json",
      request_body_schema: normalizeToolBodySchema(definition.parameters, "body"),
      request_headers: secret ? { "x-tools-secret": secret } : {},
    },
    dynamic_variables: { dynamic_variable_placeholders: {} },
  };
}

async function upsertTools(
  key: string,
  definitions: ToolDefinition[],
  baseUrl: string,
  secret?: string,
): Promise<Map<string, string>> {
  const listed = await api<{ tools?: RemoteTool[] }>(key, "GET", "/convai/tools");
  const byName = new Map(
    (listed.tools || [])
      .filter((tool) => tool.tool_config?.name)
      .map((tool) => [tool.tool_config!.name!, tool] as const),
  );
  const ids = new Map<string, string>();
  for (const definition of definitions) {
    const tool_config = webhookToolConfig(definition, baseUrl, secret);
    const existing = byName.get(definition.name);
    const remote = existing
      ? await api<RemoteTool>(key, "PATCH", `/convai/tools/${existing.id}`, {
          tool_config,
        })
      : await api<RemoteTool>(key, "POST", "/convai/tools", { tool_config });
    if (!remote.id) throw new Error(`No tool id returned for ${definition.name}`);
    ids.set(definition.name, remote.id);
    console.log(`${existing ? "updated" : "created"} tool ${definition.name}`);
  }
  return ids;
}

async function listToolIds(
  key: string,
  definitions: ToolDefinition[],
): Promise<Map<string, string>> {
  const listed = await api<{ tools?: RemoteTool[] }>(key, "GET", "/convai/tools");
  const wanted = new Set(definitions.map((definition) => definition.name));
  return new Map(
    (listed.tools || [])
      .filter(
        (tool) => tool.tool_config?.name && wanted.has(tool.tool_config.name),
      )
      .map((tool) => [tool.tool_config!.name!, tool.id]),
  );
}

async function provisionPostCallWebhook(
  key: string,
  baseUrl: string,
): Promise<{ webhookId: string; webhookSecret: string | null }> {
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhooks/elevenlabs`;
  const listed = await api<{ webhooks?: RemoteWebhook[] }>(
    key,
    "GET",
    "/workspace/webhooks?include_usages=true",
  );
  const existing = (listed.webhooks || []).find(
    (webhook) =>
      webhook.webhook_url === webhookUrl || webhook.name === `${PREFIX}post-call`,
  );
  let webhookId: string;
  let webhookSecret: string | null = null;
  if (existing) {
    webhookId = existing.webhook_id;
    await api(key, "PATCH", `/workspace/webhooks/${webhookId}`, {
      is_disabled: false,
      name: `${PREFIX}post-call`,
      retry_enabled: true,
    });
    console.log("updated post-call webhook");
  } else {
    const created = await api<{ webhook_id: string; webhook_secret?: string | null }>(
      key,
      "POST",
      "/workspace/webhooks",
      {
        settings: {
          auth_type: "hmac",
          name: `${PREFIX}post-call`,
          webhook_url: webhookUrl,
        },
      },
    );
    if (!created.webhook_id || !created.webhook_secret) {
      throw new Error("ElevenLabs did not return a post-call webhook secret");
    }
    webhookId = created.webhook_id;
    webhookSecret = created.webhook_secret;
    await api(key, "PATCH", `/workspace/webhooks/${webhookId}`, {
      is_disabled: false,
      name: `${PREFIX}post-call`,
      retry_enabled: true,
    });
    console.log("created post-call webhook");
  }

  // ElevenLabs only enables send_audio when "audio" is in events (not send_audio alone).
  await api(key, "PATCH", "/convai/settings", {
    webhooks: {
      post_call_webhook_id: webhookId,
      events: ["transcript", "audio"],
      transcript_format: "json",
      send_audio: true,
    },
  });
  console.log("enabled transcript, audio, and retry delivery");
  return { webhookId, webhookSecret };
}

async function selectLlm(key: string): Promise<string> {
  const requested = process.env.ELEVENLABS_LLM_ID?.trim() || "gemini-2.5-flash";
  const response = await api<{ llms?: Array<{ llm?: string }> }>(
    key,
    "GET",
    "/convai/llm/list",
  );
  const available = new Set((response.llms || []).map((row) => row.llm).filter(Boolean));
  if (!available.has(requested)) {
    throw new Error(
      `ELEVENLABS_LLM_ID ${requested} is unavailable in this workspace. ` +
        `Choose one returned by GET /v1/convai/llm/list.`,
    );
  }
  return requested;
}

function dynamicPlaceholders(slot: Slot): Record<string, string> {
  if (slot === "intake") {
    return {
      intake_id: "00000000-0000-4000-8000-000000000000",
      vertical: "hvac",
      vertical_name: "HVAC",
      intake_questions_json: "[]",
    };
  }
  return {
    job_id: "00000000-0000-4000-8000-000000000000",
    session_id: "00000000-0000-4000-8000-000000000000",
    company_key: slot === "negotiator" ? "tough" : slot,
    company_name: "Provider",
    vertical: "hvac",
    vertical_name: "HVAC",
    job_spec_json: "{}",
    quote_line_items_json: "[]",
    negotiation_levers_json: "[]",
    playbook: "",
    counter_strategy: "Follow the configured vendor policy.",
  };
}

function agentIdOf(agent: RemoteAgent): string | null {
  return agent.agent_id || agent.agentId || null;
}

async function listAgents(key: string): Promise<RemoteAgent[]> {
  const response = await api<{ agents?: RemoteAgent[] }>(
    key,
    "GET",
    "/convai/agents?page_size=100",
  );
  return response.agents || [];
}

async function upsertAgents(
  key: string,
  toolIds: Map<string, string>,
  definitions: ToolDefinition[],
  llm: string,
): Promise<Record<Slot, string>> {
  const existing = await listAgents(key);
  const byName = new Map(
    existing
      .filter((agent) => agent.name && agentIdOf(agent))
      .map((agent) => [agent.name!, agentIdOf(agent)!] as const),
  );
  const result = {} as Record<Slot, string>;

  for (const definition of AGENTS) {
    const prompt = readFileSync(join(process.cwd(), definition.promptPath), "utf8");
    const attached = definitions
      .filter((tool) => tool.agents.includes(definition.slot))
      .map((tool) => toolIds.get(tool.name))
      .filter((id): id is string => Boolean(id));
    const body = {
      name: definition.name,
      tags: ["leverageai", "hack-nation", definition.slot],
      conversation_config: {
        agent: {
          first_message: definition.firstMessage,
          language: "en",
          dynamic_variables: {
            dynamic_variable_placeholders: dynamicPlaceholders(definition.slot),
          },
          prompt: {
            prompt,
            llm,
            temperature: definition.temperature,
            max_tokens: 500,
            tool_ids: attached,
            enable_parallel_tool_calls: false,
          },
        },
        conversation: {
          max_duration_seconds: definition.slot === "intake" ? 420 : 300,
        },
      },
    };
    const existingId = byName.get(definition.name);
    const id = existingId
      ? (await api<RemoteAgent>(key, "PATCH", `/convai/agents/${existingId}`, body),
        existingId)
      : agentIdOf(
          await api<RemoteAgent>(key, "POST", "/convai/agents/create", body),
        );
    if (!id) throw new Error(`No agent id returned for ${definition.name}`);
    result[definition.slot] = id;
    console.log(
      `${existingId ? "updated" : "created"} agent ${definition.name} ` +
        `(${promptHash(prompt)}, ${attached.length} tools)`,
    );
  }
  return result;
}

async function verifyAgents(
  key: string,
  ids: Partial<Record<Slot, string>>,
  definitions: ToolDefinition[],
  toolIds: Map<string, string>,
): Promise<void> {
  for (const definition of AGENTS) {
    const id = ids[definition.slot];
    if (!id) throw new Error(`Missing id for ${definition.slot}`);
    const remote = await api<{
      conversation_config?: {
        agent?: { prompt?: { prompt?: string; tool_ids?: string[] } };
      };
    }>(key, "GET", `/convai/agents/${id}`);
    const localPrompt = readFileSync(join(process.cwd(), definition.promptPath), "utf8");
    const remotePrompt = remote.conversation_config?.agent?.prompt?.prompt || "";
    const actualTools = remote.conversation_config?.agent?.prompt?.tool_ids || [];
    const expectedTools = definitions
      .filter((tool) => tool.agents.includes(definition.slot))
      .map((tool) => toolIds.get(tool.name))
      .filter((id): id is string => Boolean(id))
      .sort();
    if (remotePrompt !== localPrompt) {
      throw new Error(`Prompt mismatch for ${definition.slot}`);
    }
    if ([...actualTools].sort().join(",") !== expectedTools.join(",")) {
      throw new Error(
        `Tool mismatch for ${definition.slot}: expected ${expectedTools.length} exact tool ids, got ${actualTools.length}`,
      );
    }
    console.log(
      `verified ${definition.slot}: prompt ${promptHash(remotePrompt)}, ${actualTools.length} tools`,
    );
  }
}

async function verifyPostCallWebhook(key: string, baseUrl: string): Promise<void> {
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhooks/elevenlabs`;
  const [{ webhooks = [] }, settings] = await Promise.all([
    api<{ webhooks?: RemoteWebhook[] }>(
      key,
      "GET",
      "/workspace/webhooks?include_usages=true",
    ),
    api<{
      webhooks?: {
        post_call_webhook_id?: string;
        events?: string[];
        send_audio?: boolean;
      };
    }>(key, "GET", "/convai/settings"),
  ]);
  const webhook = webhooks.find((item) => item.webhook_url === webhookUrl);
  if (!webhook) throw new Error(`Post-call webhook missing for ${webhookUrl}`);
  if (webhook.is_disabled) throw new Error("Post-call webhook is disabled");
  if (settings.webhooks?.post_call_webhook_id !== webhook.webhook_id) {
    throw new Error("Post-call webhook is not selected in ElevenLabs settings");
  }
  if (!settings.webhooks?.events?.includes("transcript")) {
    throw new Error("Post-call transcript delivery is not enabled");
  }
  if (
    !settings.webhooks?.send_audio &&
    !settings.webhooks?.events?.includes("audio")
  ) {
    throw new Error("Post-call audio delivery is not enabled");
  }
  console.log("verified post-call transcript and audio webhook");
}

function envIds(): Partial<Record<Slot, string>> {
  return Object.fromEntries(
    (Object.keys(ENV_KEYS) as Slot[])
      .map((slot) => [slot, process.env[ENV_KEYS[slot]]?.trim()])
      .filter((entry) => Boolean(entry[1])),
  ) as Partial<Record<Slot, string>>;
}

function writeEnvironment(
  ids: Record<Slot, string>,
  secrets: { toolsSecret?: string; webhookSecret?: string },
): void {
  const path = join(process.cwd(), ".env.local");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const updates = new Map<string, string>();
  for (const slot of Object.keys(ENV_KEYS) as Slot[]) {
    updates.set(ENV_KEYS[slot], ids[slot]);
    if (slot === "intake") {
      updates.set("NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID", ids[slot]);
    }
  }
  if (secrets.toolsSecret) updates.set("TOOLS_WEBHOOK_SECRET", secrets.toolsSecret);
  if (secrets.webhookSecret) {
    updates.set("ELEVENLABS_WEBHOOK_SECRET", secrets.webhookSecret);
  }
  const seen = new Set<string>();
  const lines = current.split(/\r?\n/).map((line) => {
    const eq = line.indexOf("=");
    if (eq < 1) return line;
    const key = line.slice(0, eq).trim();
    const replacement = updates.get(key);
    if (!replacement) return line;
    seen.add(key);
    return `${key}=${replacement}`;
  });
  for (const [key, value] of updates) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  writeFileSync(path, `${lines.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`);
  console.log("updated agent ids and webhook secrets in .env.local");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const key = requireEnv("ELEVENLABS_API_KEY");
  const definitions = loadToolDefinitions();
  const verifyOnly = process.argv.includes("--verify");
  if (verifyOnly) {
    const baseUrl = requireEnv("APP_BASE_URL");
    const tools = await listToolIds(key, definitions);
    await verifyAgents(key, envIds(), definitions, tools);
    await verifyPostCallWebhook(key, baseUrl);
    return;
  }
  const baseUrl = requireEnv("APP_BASE_URL");
  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.hostname !== "localhost") {
    throw new Error("APP_BASE_URL must use HTTPS (localhost is allowed only for local simulation)");
  }
  if (parsedBaseUrl.hostname === "localhost" || parsedBaseUrl.hostname === "127.0.0.1") {
    throw new Error(
      "Fresh ElevenLabs provisioning needs a public HTTPS APP_BASE_URL so tools and post-call webhooks can reach this app.",
    );
  }
  const writeEnv = process.argv.includes("--write-env");
  const toolsSecret =
    process.env.TOOLS_WEBHOOK_SECRET?.trim() ||
    (writeEnv ? randomBytes(32).toString("hex") : "");
  if (!toolsSecret) {
    throw new Error(
      "Set TOOLS_WEBHOOK_SECRET or run with --write-env to generate and store one.",
    );
  }
  const llm = await selectLlm(key);
  console.log(`model ${llm}`);
  const tools = await upsertTools(
    key,
    definitions,
    baseUrl,
    toolsSecret,
  );
  const agents = await upsertAgents(key, tools, definitions, llm);
  await verifyAgents(key, agents, definitions, tools);
  const postCall = await provisionPostCallWebhook(key, baseUrl);
  const webhookSecret =
    postCall.webhookSecret || process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error(
      "The post-call webhook already existed but ELEVENLABS_WEBHOOK_SECRET is missing. Set its original HMAC secret or delete that webhook and rerun provisioning.",
    );
  }
  if (writeEnv) writeEnvironment(agents, { toolsSecret, webhookSecret });
  await verifyPostCallWebhook(key, baseUrl);
  console.log("\nAgent ids:");
  for (const slot of Object.keys(ENV_KEYS) as Slot[]) {
    console.log(`${ENV_KEYS[slot]}=${agents[slot]}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

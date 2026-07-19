# Paste this as your first Codex 5.6 message

```
You are continuing LeverageAI from a SuperGrok handoff. Do not reinvent the product.

1. Read in order:
   - HANDOFF_CODEX.md
   - AGENTS.md
   - docs/handoff/super-grok-project-memory.md (if present)
   - README.md (note: some UI sections may be slightly outdated vs HANDOFF)

2. Working directory must be: ~/Desktop/the-negotiator (or the git clone of labishbardiya/LeverageAI)

3. Current production: https://leverageai-tawny.vercel.app
   - / = landing
   - /livee = live portal
   - /live = golden sample only (no nav link)

4. Immediate priorities (only if I ask to build; otherwise wait):
   - Wire GOOGLE_PLACES_API_KEY for live GMB discovery on Vercel
   - Re-provision ElevenLabs agents with agents/prompts/* + tool webhooks to prod
   - Keep always-one deal, live location discovery (no wrong-city snapshots)
   - Do not re-add Twilio or xAI opinion UI

5. Confirm you understood HANDOFF_CODEX.md in 5 bullets, then wait for my next task.
```

---

## After Codex answers, optional MCP setup

Replicate SuperGrok MCP servers (Neon, etc.) in Codex using the **same** command/env as `~/.grok/config.toml` `[mcp_servers.*]`.

MCP shares tools, not chat history — HANDOFF is the memory bridge.

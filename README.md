# LeverageAI

> *The AI that picks up the phone so you don’t overpay.*

Hack-Nation Challenge 01 · **ElevenLabs** · “The Negotiator” track — voice agent that phone-shops and haggles quotes end-to-end on **one screen**.

**Primary vertical:** HVAC (broken AC / 3-ton replacement)  
**Config-swap proof:** movers via `?vertical=movers` — zero code changes.

Standing law: [`AGENTS.md`](./AGENTS.md) — every agent and contributor must obey it.

---

## What judges see (one screen)

| Column | Zone | Purpose |
|--------|------|---------|
| 1 | **YOUR JOB** | Voice intake or PDF → job-spec card → **Looks right — get me quotes** |
| 2 | **THE CALLS** | 3 live (or replay) negotiations · price ticks · transcript ticker |
| 3 | **YOUR DEAL** | Ranked report · red-flag bait prices never #1 · transcript evidence |

---

## Quick start (demo-ready without ElevenLabs)

```bash
cd the-negotiator
cp .env.example .env.local   # optional for replay-only
npm install
npm run dev
```

Open:

- **Golden demo (recommended on stage):**  
  [http://localhost:3000/?replay=true](http://localhost:3000/?replay=true)
- **Movers config swap:**  
  [http://localhost:3000/?vertical=movers&replay=true](http://localhost:3000/?vertical=movers&replay=true)
- **Live path (needs agents + optional DB):**  
  [http://localhost:3000](http://localhost:3000) → *Use demo job* → confirm

```bash
npm run eval          # 5 acceptance assertions on golden run
npx tsx scripts/smoke-tools.ts   # tool honesty + ranking smoke
```

---

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ELEVENLABS_API_KEY` | Live voice / provision | ElevenLabs API |
| `ELEVENLABS_INTAKE_AGENT_ID` | Live | Agent #1 |
| `ELEVENLABS_NEGOTIATOR_AGENT_ID` | Live | Agent #2 |
| `ELEVENLABS_TOUGH_AGENT_ID` | Live | Counter #3 |
| `ELEVENLABS_STONEWALLER_AGENT_ID` | Live | Counter #4 |
| `ELEVENLABS_UPSELLER_AGENT_ID` | Live | Counter #5 |
| `APP_BASE_URL` | Provision webhooks | Public origin (ngrok/prod) |
| `NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID` | Browser mic | Optional |
| `DATABASE_URL` | Optional | Neon Postgres; **in-memory** if unset |
| `GOOGLE_PLACES_API_KEY` | Optional | Live discovery; offline snapshots otherwise |
| `XAI_API_KEY` | Optional | Document vision intake; heuristics otherwise |
| `BLOB_READ_WRITE_TOKEN` | Optional | Recording blob storage |
| `NEXT_PUBLIC_DEFAULT_VERTICAL` | Optional | Default `hvac` |

Never commit secrets. Use `.env.local` (gitignored).

### Provision agents

```bash
export ELEVENLABS_API_KEY=...
export APP_BASE_URL=https://your-ngrok-or-host
npm run provision   # primary path — see agents/SETUP.md
```

### Live mode vs replay

- **Live** only when all 5 agent IDs + `ELEVENLABS_API_KEY` are set → sequential WebSocket bridges (`src/lib/elevenlabs/bridge.ts`).
- **`?replay=true`** — offline golden insurance (zero env).
- **`?replay=live`** — offline replay of `data/golden/live-run.json` (tool-log + leverage structure).

### Production telephony path

Real PSTN is a **chosen-not-built** decision for the MVP. See `src/lib/telephony/twilio.ts` (`NOT_ENABLED` guard). ElevenLabs supports native Twilio/SIP; Places discovery shows where the call list comes from; counter-agents stand in for negotiation styles (brief-allowed).

### Live sessions (non-blocking)

`POST /api/sessions/start` returns immediately with `{ live: true, status: "bridging" }` and runs agent↔agent bridges **in the background**. Poll `GET /api/jobs/:id/state` or SSE `/api/events` — sessions move `connecting` → `live` → `closed`.

## Architecture (production stack)

```
Orchestrator (XState v5) — /architecture
  → ElevenLabs Agents (5): intake · negotiator · tough · stonewaller · upseller
  → Webhook tools (x-tools-secret) → Neon Postgres
  → Google Places (search + details, 7d cache) → ProviderScore
  → Playbook learnings → negotiator dynamic vars
  → Report (ranked · leverage chain · export)
Optional: Twilio PSTN (ENABLE_REAL_OUTBOUND) · Grok voice second opinion · Vercel Blob
```

**TCPA warning:** Real outbound cold-calls to businesses have legal risk. Keep `ENABLE_REAL_OUTBOUND=false` unless you only dial numbers you own / have consent for (demo teammate phone).

### Production deploy checklist (Vercel + Neon)

1. **Neon:** create project → run `scripts/migrate.sql` → set `DATABASE_URL` (required on serverless).
2. **Vercel:** import repo → set env vars → deploy → stable URL.
3. Set `APP_BASE_URL=https://your-app.vercel.app` and `TOOLS_WEBHOOK_SECRET=...`.
4. `npm run provision` once so agent webhooks point at the stable URL + secret headers.
5. Optional: `BLOB_READ_WRITE_TOKEN` for call audio on Vercel.
6. Stage pitch still uses `?replay=true` (zero env).

---

## Create the 5 ElevenLabs agents (human parallel track)

Full runbook: **[`agents/SETUP.md`](./agents/SETUP.md)**

| # | Role | Prompt file | Tools |
|---|------|-------------|-------|
| 1 | Intake | `agents/prompts/intake.md` | `submit_spec` |
| 2 | Negotiator | `agents/prompts/negotiator.md` | `log_quote`, `get_competing_bids`, `lookup_benchmark`, `close_session` |
| 3 | Tough | `agents/prompts/counter-agents/tough.md` | none |
| 4 | Stonewaller | `agents/prompts/counter-agents/stonewaller.md` | none |
| 5 | Upseller | `agents/prompts/counter-agents/upseller.md` | none |

**Isolation law:** never merge negotiator + counter-agent prompts. Counter pricing floors are secret.

Tool JSON schemas: `agents/tool-schemas.json`  
Webhook base: `https://YOUR_HOST/api/tools/*` (or localhost via tunnel for dashboard tools).

---

## Architecture (short)

```
[ One screen UI ]
      │
      ├─ POST /api/jobs → confirm → POST /api/sessions/start (3 vendors from config)
      │
      ├─ Negotiator ×3  ←→  Counter-agents (ElevenLabs only; no custom STT/TTS)
      │       tools → log_quote / get_competing_bids / lookup_benchmark / close_session
      │
      └─ GET /api/jobs/:id/state  (poll 1s) or GET /api/events?job_id= (SSE)
```

- Verticals: `/config/verticals/hvac.json`, `movers.json` — **no hardcoded prices in UI code**
- Honesty: leverage only via `get_competing_bids` (real DB rows)
- Outcomes: `itemized_quote` | `callback_commitment` | `documented_decline`
- Replay insurance: `?replay=true` streams `data/golden/run.json` through the same UI pipeline

---

## Postgres (optional)

```bash
psql "$DATABASE_URL" -f scripts/migrate.sql
```

Without `DATABASE_URL`, the app uses an in-memory store (fine for demo + smoke).

---

## Golden run / recorder

- Canonical payload: `data/golden/run.json` (synced under `public/golden/` for static fallback)
- Proves: price drop after real competing bid, AI disclosure, stonewaller decline + callback, upseller itemized fees + red flag, frozen job_spec
- Eval: `npm run eval` → 5/5 PASS required before submit

To “record” a live run later: export job state JSON into the same shape as `data/golden/run.json` (sessions + price_history + transcript_events + ranked_report).

---

## 60-second demo click-path (stage)

1. Open `http://localhost:3000/?replay=true`
2. **JOB** auto-fills demo 3-ton AC replacement → calls start
3. **CALLS:** watch Summit Air price **tick down** after “Competing bid used”; ComfortPro **declines** with callback; ValueHVAC fees **itemize**
4. **DEAL:** green recommendation on fair quote; red **bait-price** banner on ≥30% below market (never #1); click **Listen** / **Download transcript**
5. Optional wow: open `?vertical=movers&replay=true` — different vendors/fields, **zero code change**

### Pitch numbers (from brief + HVAC demo)

- Same job, wild phone spreads; sight-unseen quotes blow up  
- Demo: **$9,400 → $7,850** because of a **logged** competing bid — not a scripted TTS play  
- Red-flag rule: **≥30% below market = warning, not winner**

---

## Acceptance tests (Definition of Done)

1. Intake (voice or PDF) → valid job_spec → user confirms before calls  
2. 3 sessions vs 3 counter-agents; live or replay transcripts in UI  
3. ≥1 mid-call price drop after citing a real competing bid  
4. Stonewaller → `documented_decline` + callback; upseller fees itemized  
5. Report ranks, red-flags ≥30% below benchmark, transcript timestamps  
6. `movers.json` ↔ `hvac.json` swap via `?vertical=` with zero code edits  

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local app |
| `npm run build` | Production build |
| `npm run eval` | 12 acceptance assertions |
| `npm run smoke` | Tool + ranking smoke |
| `npm run provision` | Create/update 5 ElevenLabs agents |

---

## Explicit exclusions

No Twilio/real phones, no auth, no payments, no mobile layout, no multi-page nav, no vendor discovery API (3 vendors from config; Places stub can live as a comment in config only).

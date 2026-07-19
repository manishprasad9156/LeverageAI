# HANDOFF → Codex 5.6 (from SuperGrok)

**Date:** 2026-07-19  
**Product:** LeverageAI (Hack-Nation · ElevenLabs Negotiator)  
**Repo:** `labishbardiya/LeverageAI` · local `~/Desktop/the-negotiator`  
**Last SuperGrok commit (approx):** `8f19f0d` / later UI header polish  
**Owner:** Labish Bardiya  

> **Codex: read this file first.** Do not reinvent the product. Continue work; do not rewrite architecture unless asked.

---

## 1. What this product is

**LeverageAI** negotiates service quotes for the user (HVAC-first demo) using multi-agent orchestration:

1. User describes a job (+ city/ZIP).
2. System discovers local providers (live geocode + Places or OSM Overpass).
3. Three negotiator↔vendor pairs run **in parallel**.
4. Review layer always recommends **exactly one** deal.
5. User can export a human PDF report.

**Pitch story:** AC dies mid-workday → you overpay if you call one shop; Leverage shops three at once.

---

## 2. Production URLs (do not break)

| URL | Purpose |
|-----|---------|
| https://leverageai-tawny.vercel.app/ | **Landing** (clouds, LEVERAGE, Close Smart Deals) |
| https://leverageai-tawny.vercel.app/livee | **Live product portal** (composer + 3 chats + deal) |
| https://leverageai-tawny.vercel.app/live | **Golden/sample replay insurance** (no UI link — URL only) |
| GitHub | https://github.com/labishbardiya/LeverageAI |

**Prod status (as of handoff):**  
`live_mode: true`, `database: true` (Neon), `places: false` (no `GOOGLE_PLACES_API_KEY` on Vercel yet).

---

## 3. Tech stack (final)

- Next.js 16 App Router, React 19, TypeScript, Tailwind 4  
- Neon Postgres (`DATABASE_URL`)  
- Vercel Hobby deploy (`maxDuration` 300)  
- ElevenLabs ConvAI: intake + negotiator + 3 counters  
- XState job machine (wired in confirm/start/close)  
- UCB1 bandit learning (`src/lib/learning/bandit.ts`)  
- DSPy offline stub only: `scripts/dspy_train/`  
- **No Twilio/PSTN** (dropped)  
- **No xAI/Grok opinion** in product path  

---

## 4. User flow → technical flow

```
Landing /  →  Close Smart Deals  →  /livee
Composer: + upload | mic voice | mode dropdown | Send
  → extract job_spec from text/file (heuristics; vertical-aware)
  → POST /api/jobs → PATCH confirm
  → POST /api/discovery { query_text, location, vertical }  # LIVE geo
  → POST /api/sessions/start  # prefer ElevenLabs bridges; else simulate
  → poll GET /api/jobs/:id/state
  → 3 WhatsApp-style chats + Top3Map + deal review + Export PDF
```

**Voice:** mic opens ElevenLabs talk URL; `submit_spec` fills intake draft; UI **copies job text into the input box** (user presses Send).  
**Vertical dropdown** is passed into job + bridge kickoff (`vertical` dynamic var + persona wording).

---

## 5. Agentic architecture

```
POST /api/sessions/start
  → create 3 sessions (tough, stonewaller, upseller)
  → UCB1 playbook → playbookHint
  → Promise.all: 3× runAgentBridge (text-mediated WS)
        Negotiator ⟷ Tough | Stonewaller | Upseller
  → tools: log_quote, close_session, get_competing_bids, lookup_benchmark
  → buildDealReview → always one top_pick
```

**Why exactly 3 agents (judge answer):**

- **Information design:** three archetypes (quality / visit-first / lowball+fees) cover the main quote failure modes without drowning the UI.
- **Latency/cost:** parallel bridges on Vercel Hobby; 5–10 doubles token/time and screen clutter.
- **Diminishing returns:** ranking needs diversity of *behavior*, not more of the same.
- **Config-is-the-product:** vendors come from `config/verticals/*.json` — count is a product choice, not a hard engine limit; more can be added later via config + agents.
- **Fallback:** if live bridges fail, **server simulate** still writes real Neon transcripts/quotes so the demo completes.

---

## 6. Discovery (IMPORTANT — no more hardcoded city)

**Must not** show Charlotte snapshots when user asked for Chicago.

Pipeline:

1. Geocode free text / ZIP via **Nominatim** (`src/lib/places/geocode.ts`)
2. If `GOOGLE_PLACES_API_KEY` → Places API (New) searchText + details  
3. Else **OSM Overpass** near lat/lng (`src/lib/places/overpass.ts`)  
4. Offline JSON snapshot **only if geocode failed** (never wrong-city mix)

**Human gate:** add `GOOGLE_PLACES_API_KEY` on Vercel for dense GMB ratings. Until then OSM is the live free path (quality varies by Overpass load).

---

## 7. Key files

| Area | Path |
|------|------|
| Landing | `src/components/LandingPage.tsx` |
| Shared header | `src/components/SiteHeader.tsx` |
| Portal UI | `src/components/ProductWorkspace.tsx` |
| Styles | `src/app/globals.css` |
| Discovery API | `src/app/api/discovery/route.ts` |
| Sessions start | `src/app/api/sessions/start/route.ts` |
| Bridges | `src/lib/elevenlabs/bridge.ts` |
| Deal review | `src/lib/review/dealReview.ts` |
| PDF export | `src/lib/ui/exportDealPdf.ts` |
| Prompts | `agents/prompts/negotiator.md`, `agents/prompts/counter-agents/*` |
| Vertical configs | `config/verticals/*.json` |
| Law | `AGENTS.md` |

---

## 8. Env vars (names only — secrets in `.env.local` / Vercel)

Required for live:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_INTAKE_AGENT_ID`
- `ELEVENLABS_NEGOTIATOR_AGENT_ID`
- `ELEVENLABS_TOUGH_AGENT_ID` (or `*_COUNTER_*` aliases)
- `ELEVENLABS_STONEWALLER_AGENT_ID`
- `ELEVENLABS_UPSELLER_AGENT_ID`
- `DATABASE_URL` (Neon)
- `APP_BASE_URL` = `https://leverageai-tawny.vercel.app`

Optional:

- `GOOGLE_PLACES_API_KEY` ← **still missing on prod**
- `TOOLS_WEBHOOK_SECRET`
- `NEXT_PUBLIC_ELEVENLABS_INTAKE_AGENT_ID`

**Do not commit secrets.** Local file: `.env.local` (gitignored).

Known agent IDs (from prod `/api/status` — still need dashboard tool webhooks):

- intake `agent_7801kxvmsyedf9ksnn4jwfhax5we`
- negotiator `agent_6901kxvmszydf36sztc11hcbg3eg`
- tough `agent_9001kxvmt1f1ecc9ag21tkvbgy61`
- stonewaller `agent_3301kxvmt30wewaanp4xv1wsd9hz`
- upseller `agent_4501kxvmt4b1e7p98hmvqdzfaz0s`

---

## 9. UI / design decisions (current)

- **Instrument Serif** for LEVERAGE + headlines  
- Cloud **video** background (`public/media/clouds-loop.mp4`)  
- Liquid glass panels; black outer frame (Clean-style)  
- Headline: *You **name** the job. / We **lock** the price.* (italic name/lock + slight space after)  
- Home + live share `SiteHeader` so LEVERAGE does not jump  
- Close Smart Deals = liquid glass **buttons** (not text links)  
- Upload = **+**; voice = **mic icon**; mode dropdown **left of Send**  
- No “Sample” in UI (URL `/live` only)  
- No “One job. Three shops…” tagline  
- Always **one** recommended deal  
- Export = printable **PDF** HTML, not JSON dump  

---

## 10. Open / fragile items for Codex

Priority order:

1. **GOOGLE_PLACES_API_KEY** on Vercel + enable Places API (New) for real GMB ratings  
2. **Re-provision ElevenLabs** prompts from `agents/prompts/*` + tool webhooks → `APP_BASE_URL/api/tools/*`  
3. Voice intake: confirm `submit_spec` webhook hits prod so mic fills the box reliably  
4. Overpass can be slow/empty under load — Places key is the real fix for dense metros  
5. Drop demo video into landing blank when asset ready  
6. README still describes older three-column UI in places — update when free  
7. Eval: `npm run eval` should stay 18/18  

---

## 11. Commands

```bash
cd ~/Desktop/the-negotiator
npm install
npm run dev          # local
npm run eval         # 18 assertions
npm run provision    # ElevenLabs agents (needs keys + APP_BASE_URL)
npx vercel --prod    # deploy (linked project leverageai)
```

---

## 12. Memory exports (SuperGrok)

Also copied next to this file:

- `docs/handoff/super-grok-global-memory.md` — Labish global notes  
- `docs/handoff/super-grok-project-memory.md` — negotiator workspace memory  
- `docs/handoff/CODEX_FIRST_PROMPT.md` — paste into Codex  

SuperGrok sessions remain on disk under `~/.grok/sessions/` if you need raw history.

---

## 13. Explicit non-goals (unless Labish asks)

- Real PSTN / Twilio dialing  
- Fake demo-only theater without Neon  
- Reintroducing xAI opinion widgets  
- Equal demo depth for every vertical before HVAC pitch works  

---

*Generated by SuperGrok handoff for Codex 5.6 migration. Prefer this file over guessing.*

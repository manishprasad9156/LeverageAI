# Global Memory — Labish Bardiya

Public profiles + research PDF (`all-research-work.pdf`, studied Jul 2026). Expand as we work.

## Identity
- Labish Bardiya · Jaipur, Rajasthan · labishbardiya.com
- LinkedIn / X / GitHub / YouTube / DEV: @labishbardiya
- Git: Labish Bardiya / Labishjain7@gmail.com · gh SSH: labishbardiya
- GitHub bio: B.Tech CSE ’27 | AI/ML Research Intern | Samsung Semiconductor Fellow | ISRO Space Challenge Finalist | InventX’25 Jury Awardee | Competitive Programmer
- X bio: Founder @Bruxlix · Prev. AIISC UofSC, Samsung, IIIT-H

## Wins / admissions (keep current)
### Algoverse AI Research Program 2026 — OFFERED (17 Jul 2026)
- **Status:** Admitted; 30% scholarship; offer letter from **Kevin Zhu** (Program Director)
- **Portal email:** labishjain7@gmail.com
- **Tuition:** $3,325 → scholarship −$997.50 → **$2,327.50** net; $50 refundable deposit to hold spot; pay full/monthly/weekly at start
- **Tracks:** LLM Research **or** Applied ML Research (chosen with mentor)
- **Output goal:** research paper → arXiv + submission to top AI conference (NeurIPS / EMNLP / AAAI / ICLR / ICML depending on session)
- **Sessions (identical resources; as of letter):**
  - May 24 – Aug 16 — **Closed** — Sun 11:00am–12:30pm PT — NeurIPS
  - June 21 – Sep 13 — Sun 9:00–10:30am PT — AAAI
  - July 11 – Oct 4 — Sat 9:00–10:30am PT — AAAI
  - Aug 23 – Nov 15 — Sun 1:00–2:30pm PT — ICLR & ICML
  - Sep 20 – Dec 13 — Sun 11:00am–12:30pm PT — ICLR & ICML
- **First weeks:** track selection, team matching, research ideation
- **Note:** acceptance / cohort choice not recorded here yet — ask before assuming enrolled
- **Aid ask (17 Jul 2026):** emailed admissions for need-based increase to 75–100%; family income ~$18–20k; ITR + docs already on scholarship form (~1 week prior). Status: **waiting on reply**

## How he works
- SuperGrok = primary AI co-founder; solo founder-operator (learn → build → ship → distribute)
- Skills: posting, outreach, job · Workspace for jobs: ~/.grok/job-search/
- Heavy tools (Android Studio, Docker, Ollama, Cursor, Claude Code) only when needed
- Big-tech resume *signals* matter (metrics, depth, production, papers, contests)—not fantasy stacking of fake experiences

## Research archive (full stand-in for deleted research PDF)

> Captured from Labish’s research log PDF (all-research-work.pdf) so the PDF can be deleted without loss of *his* work product: meeting notes, slides content, paper analyses, pipelines, status. Not a claim of co-authorship on mentor papers unless stated.

### A. Context, people, timeline
- **Mentor:** Dr. Utkarshani Jaimini (kHealth / pediatric asthma digital phenotype; historically Kno.e.sis Wright State / Dayton Children’s collaborations in published work)
- **Student:** Labish Bardiya
- **Notes dated:** review of meeting 6 May; MoM **16 Jul 2025**; progress report **5 Sep 2025**; PDF cover note date 16 Jul 2025
- **Parallel track:** InventX @ **IIT Gandhinagar** — “System and Method for **Bruxism Severity Assessment Using Multi-Sensor Face Mask**” (reason research restarted mid-summer)
- **Theme:** Causal multi-agent RL (causal MARL) → safer / interpretable multi-agent decisions; apps: **healthcare DTRs + asthma digital phenotyping**, **decentralized traffic signals**

### B. Assigned tasks (from mentor) and Labish status (as of Sep 2025 notes)
1. Knowledge sharing in multi-agent systems — **Completed** (presentation)
2. Traffic light control as causal MARL case — **Completed** (presentation)
3. DTRs in healthcare: conceptual papers + GitHub/code — **In progress** (found Blumlein causal-tree DTR paper + code; deep-dive “can this run on kHealth?”; next: DTR-Bench / DTRGym + datasets)
4. Read/analyze Jaimini et al. kHealth asthma JMIR paper — **Completed** (presentation)
5. Causal MARL review paper (Grimbly et al.) — presented / core curriculum
- Explicit open: **simulation + experimentation** on DTR codebases and longitudinal healthcare datasets (HuggingFace/Kaggle/Stanford EHR-style links noted)

### C. Causal MARL — concepts Labish studied (Grimbly et al., NeurIPS Coop AI 2021)
**Paper:** St John Grimbly, Jonathan Shock, Arnu Pretorius — *Causal Multi-Agent Reinforcement Learning: Review and Open Problems* — Cooperative AI Workshop NeurIPS 2021 — arXiv:2111.06721  
**Authors’ claim:** causality-first MARL → better safety, interpretability, robustness, theory for **emergent** multi-agent behavior.

**MARL basics**
- Agents, actions, states, rewards, learning loop
- MDP: (S, A, T, R, γ); Markov property (future depends on present only)
- **POMDP / Dec-POMDP:** partial observability; multi-agent decentralized observations
- Real-world Markov often fails: hidden variables, history dependence → e.g. **Dynamic Treatment Regimes (DTRs)**

**Pearl ladder of causation**
1. **Association (seeing)** — P(Y|X); pattern recognition / ML  
2. **Intervention (doing)** — P(Y|do(X)); RCTs, RL actions  
3. **Counterfactuals (imagining)** — “what if I had done X′ given I saw X,Y?”  

Hierarchy: counterfactuals ⊇ interventions ⊇ associations.

**Structural Causal Model (SCM)**
- Structural assignments X_j ← f_j(PA_j, U_j); joint noise over exogenous U  
- Causal graph / CBN (DAG); arrows = causal influence  
- **Intervention:** replace assignments (do-calculus); cuts confounding paths into intervened var  
- **Counterfactual SCM:** condition noise on observed evidence, then intervene differently  
- Smoking/cancer example: association confounded by genetics G; need do(S) not just P(C|S)

**Why CRL / causal MARL**
- Off-policy learning, data fusion, transportability, counterfactual reasoning  
- Multi-agent: **decentralization**, **credit assignment**, non-stationarity, communication  
- Related multi-agent ideas: counterfactual multi-agent policy gradients (Foerster et al.), difference rewards, MACMs (multi-agent causal models), factored Dec-POMDPs, causal communication  

**Research directions Labish listed**
- Counterfactual reasoning for planning  
- Causal communication protocols  
- Safety & robustness: healthcare, human–robot, decentralized traffic/resource control  
- Knowledge sharing, traffic (MACM example), handling non-stationarity  

### D. Dynamic Treatment Regimes (DTRs)
- **Definition:** plan for changing treatments over time based on patient response  
- **Sequential, personalized, adaptive** (online-ish)  
- MDP assumption fails: needs history + latent factors  
- Alternatives: POMDPs (beliefs over state) + **SCMs** for what-if / confounders  
- POMDP limits: may not capture deep treatment history (e.g. steroid resistance); weak pure counterfactuals  
- SCM challenges: data hungry, graph misspecification, compute  

**Papers**
- Murphy / classic DTR framing (via review)  
- Blumlein et al. *Learning optimal dynamic treatment regimes using causal tree methods in medicine* (MLHC / PMLR 2022) — **DTR-CT** (causal trees) and **DTR-CF** (causal forests); backward induction; propensity-weighted blips; public code  

### E. kHealth / Jaimini asthma paper (mastered content)
**Cite:** Jaimini U, Thirunarayan K, Kalra M, Venkataraman R, Kadariya D, Sheth A. “How Is My Child’s Asthma?” Digital Phenotype and Actionable Insights for Pediatric Asthma. *JMIR Pediatr Parent* 2018;1(2):e11988. doi:10.2196/11988  

**Problem**
- Pediatric asthma common; traditional care: clinic every 3–6 months + **ACT** (4-week recall) → poor real-time triggers, adherence, control  
- US burden notes in slides (~4.7M children / high attack counts — cite era-specific stats carefully)  

**Prior approaches & limits:** episodic ACT, self-report surveys (recall bias), sparse env checks, poor adherence tracking  

**kHealth system**
| Layer | Components |
|-------|------------|
| **Kit** | Android tablet app (symptoms/meds ~2×/day), Fitbit (activity/sleep), Microlife peak flow + FEV1, Foobot (indoor air) |
| **Cloud** | Firebase sync, auth, security |
| **Dashboard** | Multimodal viz; explore correlations; clinician tools |

**Digital phenotype:** moment-by-moment individual phenotype in situ via personal devices (active + passive sensing).  

**Study design (paper)**
- Observational longitudinal; Dayton Children’s Hospital asthma specialist recruitment ages ~5–17  
- ~100 consented; **95 completed**; 1-month (n≈70) or 3-month (n≈25); incentives $50/$100  
- Analysis often **n=82** with ≥7 days data (NHLBI week minimum); ACT from EMR for **n=57** validation  
- Kit compliance ~**66–75%** average  

**Scores Labish must know**
- **TSS** = (# symptoms experienced) / study period  
- **PSS** = (# days with symptoms) / study period  
- **RS (Rescue)** = rescue med intakes / period  
- **AcS (Activity)** = weighted activity limitation / period  
- **AwS (Awakening)** = nights woken / period  
- **DPS-T** = TSS + RS + AcS + AwS  
- **DPS-P** = PSS + RS + AcS + AwS (closer to ACT-style day counting)  
- **CCS** = days controller taken / period; **high ≥0.70**, well 0.30–0.70, poor <0.30  
- Control thresholds (their adaptation): very poorly controlled **DPS≥1**, not well **0.28≤DPS<1**, well **DPS<0.28**  
- ACT: age-dependent cutoffs (e.g. ≥20 well controlled in older kids — use paper tables when precise)  

**Key result**
- Negative Kendall τ between ACT and DPS ≈ **−0.509** (P<.01) — higher ACT better control; higher DPS worse phenotype load  
- Cohort split example (DPS-T): ~37% very poorly, 26% not well, 38% well controlled  
- **Actionable insight matrix:** cross **control level × CCS** → e.g. poorly controlled + highly compliant → reassess med/dose/triggers; poorly controlled + poorly compliant → adherence barriers  

**Limitations Labish emphasized**
- Observational; ACT often before/not after deployment; not full sequential decision logging  
- Not randomized treatment choices → **weak for learning optimal DTR policies** without reformatting or new instrumentation  
- Open questions from notes: predict attacks? causal trigger–symptom links?  

### F. Labish’s DTR-on-kHealth pipeline (his design work)
If data reorganized into decision problem:
0. Epochs (daily/weekly) + finite **action set** (maintain vs step-up controller, adherence support, trigger messaging…)  
1. Histories H_t = baseline C, features X_1:t, actions A_1:t−1, adherence, exposures, DPS components  
2. Terminal/horizon outcomes (exacerbation, week DPS, cumulative control)  
3. Assumptions: consistency/SUTVA, **positivity**, sequential exchangeability (enrich if clinician intent unmeasured)  
4. Propensity π_t(A|H)  
5. Backward DTR-CT/CF; blip τ_t; rule δ_t = 1{τ_t>0} or argmax  
6. Off-policy eval / temporal CV vs Q-learning/tree RL  
7. Clinical guardrails (dose change limits)  
8. Sensitivity / overlap diagnostics  
9. If identification weak → micro-randomized / SMART-like pilot  

**Codes he flagged:** DTR paper code; arXiv 2405.18610; github.com/GilesLuo/DTR-Bench; github.com/GilesLuo/DTRGym  

### G. Knowledge sharing in MAS (his notes)
- **Explicit communication:** structured messages (obs, intentions, parameters)  
- **Emergent communication:** learned protocols; goal of human-intelligible signals  
- **Causal communication:** share cause–effect (“A → B”), help credit assignment  
- **Transfer learning / imitation / causal imitation:** reuse policies; when & why to imitate  
- **Open direction:** human-intelligible emergent causal communication protocols (Karten CMU thesis cited)  

### H. Traffic light control case (his synthesis)
- **Problem:** when to switch signals → flow, congestion, wait times; economic/env costs of congestion (order-of-magnitude stats in slides; verify if citing publicly)  
- **RL:** each intersection agent; observe queues/phases; act green/yellow/red; reward ↓ delay  
- **Dec-POMDP:** multi-agent, partial obs (adjacent only), joint/global objective  
- **Traditional limits:** fixed-time rigid; actuated local; SCOOT/SCATS central bottleneck  
- **MARL limits:** non-stationarity, credit, unsafe exploration, scale, partial obs  
- **Causal+MARL workflow:** observe + neighbor causal summaries → SCM inference → counterfactual “what if longer green?” → policy update → coordinate (“releasing traffic in 10s”) → continuous learn  
- **Resolutions:** SCMs for non-stationarity; counterfactuals for credit; virtual what-if before unsafe explore; local causal models for scale; causal fill-in for partial obs  

### I. Background paper pack in PDF (not Labish’s authorship; he studied)
- Full Jaimini et al. JMIR text (methods, tables, HIPAA, NIH R01HD087132)  
- Chan et al. *Asthma Mobile Health Study* / ResearchKit (Nat Biotechnol) — large remote smartphone asthma study; recruitment/retention/selection bias lessons; ResearchKit feasibility  
- Use only as **background literacy**, not as “I ran the AMHS”  

### J. Ready-to-speak lines

**Overall**
> I did a research internship under Dr. Utkarshani Jaimini on causal multi-agent reinforcement learning, with application tracks in pediatric asthma decision support and multi-agent traffic control, alongside product work on bruxism sensing at InventX IITGN.

**Causal MARL**
> I studied the NeurIPS Cooperative AI workshop review on causal MARL—how structural causal models and counterfactuals address non-stationarity, credit assignment, and safe multi-agent learning beyond plain Dec-POMDPs.

**kHealth**
> I deeply analyzed Dr. Jaimini’s kHealth work: multimodal digital phenotyping for pediatric asthma, DPS and compliance scores validated against ACT, and the open problem of turning that observational stream into causal sequential policies—DTRs.

**DTR bridge**
> I asked whether causal-tree DTR algorithms can run on kHealth if we restructure into decision epochs with logged actions and confounders—and documented what instrumentation is still missing.

**Traffic**
> I used urban traffic signal control as a concrete Dec-POMDP where SCMs and causal communication can address non-stationarity and credit assignment better than reactive MARL alone.

**60s elevator**
> During a research internship with Dr. Utkarshani Jaimini, I focused on causal multi-agent RL—using Pearl’s ladder and structural causal models to go beyond correlational multi-agent learning. I reviewed the NeurIPS Cooperative AI paper on open problems in causal MARL, then specialized in healthcare sequential decisions: digital phenotyping for pediatric asthma (kHealth), and how dynamic treatment regimes could be learned if observational streams are reorganized into causal sequential decision problems. In parallel I worked on a multi-sensor bruxism assessment project at InventX IITGN. The open thread was moving from literature and problem formulation into simulation and code.

### K. Honest boundary (what the archive is NOT)
- Not a publication list under Labish’s name for kHealth/AMHS  
- Simulation/code results were **not finished** in the log  
- Stats from US asthma / traffic cost slides should be re-checked if used in formal writing  

### L. Source of this archive
- Extracted from Labish’s compiled PDF of research internship notes + papers (Desktop all-research-work.pdf), archived into Grok memory Jul 2026 so PDF may be deleted.

## Products (public)
- Bruxlix, CureNet, ecosphere-esg-platform, facepipe, VidyaBot, Lixplore/ScholarScout, hackotomate, openwhisp, Vigil, etc.

## Active
- Hack-Nation 6th · Jul 18–19 2026 · iWorkk Gurgaon

## Red lines
- No secrets in this file · no fake experience · no invented outreach personalization
